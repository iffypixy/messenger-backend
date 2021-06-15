import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException
} from "@nestjs/websockets";
import {Server} from "socket.io";
import {In, LessThan, MoreThan, Not} from "typeorm";
import {UseFilters, UsePipes, ValidationPipe} from "@nestjs/common";

import {FilePublicData, FileService} from "@modules/upload";
import {UserService} from "@modules/user";
import {ExtendedSocket, ID} from "@lib/typings";
import {queryLimit} from "@lib/queries";
import {extensions} from "@lib/files";
import {BadRequestTransformationFilter, WebsocketsService} from "@lib/websockets";
import {DirectChatMemberPublicData, DirectChatMessagePublicData, DirectChatPublicData} from "../lib/typings";
import {DirectChatMemberService, DirectChatMessageService, DirectChatService} from "../services";
import {publiciseDirectChatMember} from "../entities";
import {
  GetDirectChatMessagesDto,
  CreateDirectChatMessageDto,
  GetDirectChatDto,
  GetDirectChatAttachmentsDto,
  BanDirectChatPartnerDto,
  UnbanDirectChatPartnerDto, ReadDirectMessageDto
} from "./dtos";
import {directChatServerEvents as serverEvents, directChatClientEvents as clientEvents} from "./events";
import {LessThanDate} from "@lib/operators";

@UsePipes(ValidationPipe)
@UseFilters(BadRequestTransformationFilter)
@WebSocketGateway()
export class DirectChatGateway {
  constructor(
    private readonly memberService: DirectChatMemberService,
    private readonly messageService: DirectChatMessageService,
    private readonly chatService: DirectChatService,
    private readonly fileService: FileService,
    private readonly userService: UserService,
    private readonly websocketsService: WebsocketsService
  ) {
  }

  @WebSocketServer()
  wss: Server;

  @SubscribeMessage(serverEvents.GET_CHATS)
  async handleGettingChats(
    @ConnectedSocket() socket: ExtendedSocket
  ): Promise<{
    chats: ({
      partner: DirectChatMemberPublicData;
      lastMessage: DirectChatMessagePublicData;
      isBanned: boolean;
      numberOfUnreadMessages: number
    } & DirectChatPublicData)[]
  }> {
    const members = await this.memberService.find({
      where: {
        user: socket.user
      }
    });

    const chatsIds = members.map(({chat}) => chat.id);

    const partners = await this.memberService.find({
      where: {
        chat: {
          id: In(chatsIds)
        },
        user: {
          id: Not(socket.user.id)
        }
      }
    });

    const messages = await this.messageService.find({
      where: {
        chat: {
          id: In(chatsIds)
        }
      },
      order: {
        createdAt: "DESC"
      }
    });

    const numbersOfUnreadMessages: {chatId: ID; number: number}[] = [];

    for (let i = 0; i < members.length; i++) {
      const member = members[i];

      const number = await this.messageService.count({
        where: {
          chat: member.chat,
          isRead: false,
          sender: {
            id: Not(member.id)
          }
        }
      });

      numbersOfUnreadMessages.push({
        chatId: member.chat.id, number
      });
    }

    return {
      chats: members.map((member) => {
        const partner = partners.find((partner) => partner.chat.id === member.chat.id);
        const lastMessage = messages.find((msg) => msg.chat.id === member.chat.id) || null;
        const {number} = numbersOfUnreadMessages.find(({chatId}) => chatId === member.chat.id);

        if (!partner) return;

        return {
          ...member.chat.public,
          partner: partner.public,
          lastMessage: lastMessage && lastMessage.public,
          isBanned: member.isBanned,
          numberOfUnreadMessages: number
        };
      }).filter(Boolean)
    };
  }

  @SubscribeMessage(serverEvents.GET_MESSAGES)
  async handleGettingMessages(
    @ConnectedSocket() socket: ExtendedSocket,
    @MessageBody() dto: GetDirectChatMessagesDto
  ): Promise<{messages: DirectChatMessagePublicData[]}> {
    const {chat} = await this.chatService.findOneByUsersIds([socket.user.id, dto.partner]);

    if (!chat) throw new WsException("Invalid credentials.");

    const messages = await this.messageService.find({
      where: {chat},
      skip: +dto.skip,
      take: queryLimit,
      order: {
        createdAt: "DESC"
      }
    });

    return {
      messages: messages
        .sort((a, b) => +a.createdAt - +b.createdAt)
        .map((message) => message.public)
    };
  }

  @SubscribeMessage(serverEvents.CREATE_MESSAGE)
  async handleCreatingMessage(
    @ConnectedSocket() socket: ExtendedSocket,
    @MessageBody() dto: CreateDirectChatMessageDto
  ): Promise<{message: DirectChatMessagePublicData}> {
    const error = new WsException("Invalid credentials.");

    if (dto.partner === socket.user.id) throw error;

    const partner = await this.userService.findOne({
      where: {
        id: dto.partner
      }
    });

    if (!partner) throw error;

    let {chat, first, second} = await this.chatService.findOneByUsersIds([socket.user.id, dto.partner]);

    if (chat && (first.isBanned || second.isBanned))
      throw new WsException("No permission to send message to this partner.");

    if (!chat) {
      chat = await this.chatService.create({});

      first = await this.memberService.create({
        user: socket.user, chat
      });

      second = await this.memberService.create({
        user: partner, chat
      });
    }

    const parent = dto.parent && await this.messageService.findOne({
      where: {
        id: dto.parent, chat
      }
    });

    const files = dto.files && await this.fileService.find({
      where: {
        id: In(dto.files),
        user: socket.user,
        extension: In(extensions.all)
      }
    });

    const images = dto.images && await this.fileService.find({
      where: {
        id: In(dto.images),
        user: socket.user,
        extension: In(extensions.images)
      }
    });

    const audio = dto.audio && await this.fileService.findOne({
      where: {
        id: dto.audio,
        user: socket.user,
        extension: In(extensions.audios)
      }
    });

    const message = await this.messageService.create({
      chat, parent, audio,
      files: !audio ? files : null,
      images: !audio ? images : null,
      text: !audio ? dto.text : null,
      sender: first
    });

    const sockets = this.websocketsService.getSocketsByUserId(this.wss, second.user.id);

    sockets.forEach((client) => {
      socket.to(client.id).emit(clientEvents.MESSAGE, {
        message: message.public,
        chat: chat.public,
        partner: first.public
      });
    });

    return {
      message: message.public
    };
  }

  @SubscribeMessage(serverEvents.GET_CHAT)
  async handleGettingChat(
    @ConnectedSocket() socket: ExtendedSocket,
    @MessageBody() dto: GetDirectChatDto
  ): Promise<{
    chat: {
      partner: DirectChatMemberPublicData;
      isBanned: boolean;
    } & DirectChatPublicData
  }> {
    const {chat, first, second} = await this.chatService.findOneByUsersIds([socket.user.id, dto.partner]);

    if (!chat) throw new WsException("Chat is not found.");

    return {
      chat: {
        ...chat,
        partner: second.public,
        isBanned: first.isBanned
      }
    };
  }

  @SubscribeMessage(serverEvents.GET_IMAGES)
  async handleGettingImages(
    @ConnectedSocket() socket: ExtendedSocket,
    @MessageBody() dto: GetDirectChatAttachmentsDto
  ): Promise<{images: {id: ID; url: string; createdAt: Date}[]}> {
    const {chat} = await this.chatService.findOneByUsersIds([socket.user.id, dto.partner]);

    if (!chat) throw new WsException("Chat is not found.");

    const messages = await this.messageService.findWithAttachments("images", {
      skip: dto.skip,
      where: {chat},
      order: {
        createdAt: "DESC"
      }
    });

    return {
      images: messages.reduce((prev, current) => {
        const {id, images, createdAt} = current.public;

        return [...prev, ...images.map((url) => ({id, url, createdAt}))];
      }, [])
    };
  }

  @SubscribeMessage(serverEvents.GET_AUDIOS)
  async handleGettingAudios(
    @ConnectedSocket() socket: ExtendedSocket,
    @MessageBody() dto: GetDirectChatAttachmentsDto
  ): Promise<{audios: {id: ID; url: string; createdAt: Date}[]}> {
    const {chat} = await this.chatService.findOneByUsersIds([socket.user.id, dto.partner]);

    if (!chat) throw new WsException("Chat is not found.");

    const messages = await this.messageService.findWithAttachments("audio", {
      skip: dto.skip,
      where: {chat},
      order: {
        createdAt: "DESC"
      }
    });

    return {
      audios: messages.map((message) => {
        const msg = message.public;

        return {
          id: msg.id,
          url: msg.audio,
          createdAt: msg.createdAt
        };
      })
    };
  }

  @SubscribeMessage(serverEvents.GET_FILES)
  async handleGettingFiles(
    @ConnectedSocket() socket: ExtendedSocket,
    @MessageBody() dto: GetDirectChatAttachmentsDto
  ): Promise<{files: {id: ID; file: FilePublicData; createdAt: Date}[]}> {
    const {chat} = await this.chatService.findOneByUsersIds([socket.user.id, dto.partner]);

    if (!chat) throw new WsException("Chat is not found.");

    const messages = await this.messageService.findWithAttachments("files", {
      skip: dto.skip,
      where: {chat},
      order: {
        createdAt: "DESC"
      }
    });

    return {
      files: messages.reduce((prev, current) => {
        const {id, files, createdAt} = current.public;

        return [...prev, ...files.map((file) => ({id, file, createdAt}))];
      }, [])
    };
  }

  @SubscribeMessage(serverEvents.BAN_PARTNER)
  async handleBanningPartner(
    @ConnectedSocket() socket: ExtendedSocket,
    @MessageBody() dto: BanDirectChatPartnerDto
  ): Promise<{chat: {partner: DirectChatMemberPublicData; isBanned: boolean} & DirectChatPublicData}> {
    const {chat, first, second} = await this.chatService.findOneByUsersIds([socket.user.id, dto.partner]);

    if (!chat) throw new WsException("Chat is not found.");

    if (second.isBanned) throw new WsException("Partner has been already banned.");

    const member = await this.memberService.save({
      ...second,
      isBanned: true
    });

    const sockets = this.websocketsService.getSocketsByUserId(this.wss, second.user.id);

    sockets.forEach((client) => {
      socket.to(client.id).emit(clientEvents.BANNED, {
        chat: chat.public,
        partner: first.public
      });
    });

    return {
      chat: {
        ...chat.public,
        partner: publiciseDirectChatMember(member),
        isBanned: first.isBanned
      }
    };
  }

  @SubscribeMessage(serverEvents.UNBAN_PARTNER)
  async handleUnbanningPartner(
    @ConnectedSocket() socket: ExtendedSocket,
    @MessageBody() dto: UnbanDirectChatPartnerDto
  ): Promise<{chat: {partner: DirectChatMemberPublicData; isBanned: boolean} & DirectChatPublicData}> {
    const {chat, first, second} = await this.chatService.findOneByUsersIds([socket.user.id, dto.partner]);

    if (!chat) throw new WsException("Chat is not found.");

    if (!second.isBanned) throw new WsException("Partner has been already unbanned.");

    const member = await this.memberService.save({
      ...second,
      isBanned: false
    });

    const sockets = this.websocketsService.getSocketsByUserId(this.wss, second.user.id);

    sockets.forEach((client) => {
      socket.to(client.id).emit(clientEvents.UNBANNED, {
        chat: chat.public,
        partner: first.public
      });
    });

    return {
      chat: {
        ...chat.public,
        partner: publiciseDirectChatMember(member),
        isBanned: first.isBanned
      }
    };
  }

  @SubscribeMessage(serverEvents.READ_MESSAGE)
  async handleReadingMessage(
    @ConnectedSocket() socket: ExtendedSocket,
    @MessageBody() dto: ReadDirectMessageDto
  ): Promise<{chat: DirectChatPublicData; message: DirectChatMessagePublicData}> {
    const {chat, first} = await this.chatService.findOneByUsersIds([socket.user.id, dto.partner]);

    if (!chat) throw new WsException("Chat is not found.");

    const message = await this.messageService.findOne({
      where: {
        chat, id: dto.message,
        isRead: false,
        sender: {
          id: Not(first.id)
        }
      }
    });

    if (!message) throw new WsException("Message is not found.");

    await this.messageService.update({
      id: message.id
    }, {
      isRead: true
    });

    await this.messageService.update({
      chat,
      createdAt: LessThanDate(message.createdAt),
      isRead: false,
      sender: {
        id: Not(first.id)
      }
    }, {
      isRead: true
    });

    const sockets = this.websocketsService.getSocketsByUserId(this.wss, dto.partner);

    sockets.forEach((client) => {
      socket.to(client.id).emit(clientEvents.MESSAGE_READ, {
        message: message.public,
        chat: chat.public,
        partner: first.public
      });
    });

    return {
      message: message.public,
      chat: chat.public
    };
  }
}