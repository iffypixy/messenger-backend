"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DirectController = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("typeorm");
const auth_1 = require("../../auth");
const users_1 = require("../../users");
const uploads_1 = require("../../uploads");
const typings_1 = require("../../../lib/typings");
const queries_1 = require("../../../lib/queries");
const services_1 = require("../services");
const direct_1 = require("../dtos/direct");
let DirectController = class DirectController {
    constructor(memberService, messageService, chatService) {
        this.memberService = memberService;
        this.messageService = messageService;
        this.chatService = chatService;
    }
    async getChats(user) {
        const members = await this.memberService.find({
            where: { user }
        });
        const chatsIds = members.map(({ chat }) => chat.id);
        const partners = await this.memberService.find({
            where: {
                chat: {
                    id: typeorm_1.In(chatsIds)
                },
                user: {
                    id: typeorm_1.Not(user.id)
                }
            }
        });
        const messages = await this.messageService.find({
            where: {
                chat: {
                    id: typeorm_1.In(chatsIds)
                }
            },
            take: 1,
            order: {
                createdAt: "DESC"
            }
        });
        const unreads = [];
        for (let i = 0; i < members.length; i++) {
            const member = members[i];
            const amount = await this.messageService.count({
                where: {
                    chat: member.chat,
                    isRead: false,
                    sender: {
                        id: typeorm_1.Not(member.id)
                    }
                }
            });
            unreads.push({
                id: member.chat.id, amount
            });
        }
        return {
            chats: members.map((member) => {
                const partner = partners.find(({ chat }) => chat.id === member.chat.id);
                const lastMessage = messages.find(({ chat }) => chat.id === member.chat.id) || null;
                const { amount } = unreads.find(({ id }) => id === member.chat.id);
                return {
                    details: member.chat.public,
                    partner: partner.public,
                    isBanned: member.public.isBanned,
                    lastMessage: lastMessage && lastMessage.public,
                    unread: amount
                };
            })
        };
    }
    async getMessages(user, partnerId, dto) {
        const { chat } = await this.chatService.findOneByUsersIds([user.id, partnerId]);
        if (!chat)
            throw new common_1.BadRequestException("Chat is not found");
        const messages = await this.messageService.find({
            where: { chat },
            skip: +dto.skip,
            take: queries_1.queryLimit,
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
    async getChat(user, partnerId) {
        const { chat, first, second } = await this.chatService.findOneByUsersIds([user.id, partnerId]);
        if (!chat)
            throw new common_1.BadRequestException("Chat is not found");
        return {
            chat: {
                details: chat.public,
                partner: second.public,
                isBanned: first.isBanned
            }
        };
    }
    async getAttachedImages(user, partnerId, dto) {
        const { chat } = await this.chatService.findOneByUsersIds([user.id, partnerId]);
        if (!chat)
            throw new common_1.BadRequestException("Chat is not found");
        const messages = await this.messageService.findWithAttachments("images", {
            skip: dto.skip,
            where: { chat },
            order: {
                createdAt: "DESC"
            }
        });
        return {
            images: messages.reduce((prev, current) => {
                const { id, images, createdAt } = current.public;
                return [
                    ...prev,
                    ...images.map((url) => ({ id, url, createdAt }))
                ];
            }, [])
        };
    }
    async getAttachedAudios(user, partnerId, dto) {
        const { chat } = await this.chatService.findOneByUsersIds([user.id, partnerId]);
        if (!chat)
            throw new common_1.BadRequestException("Chat is not found");
        const messages = await this.messageService.findWithAttachments("audio", {
            skip: +dto.skip,
            where: { chat },
            order: {
                createdAt: "DESC"
            }
        });
        return {
            audios: messages.map((message) => {
                const { id, audio: url, createdAt } = message.public;
                return { id, url, createdAt };
            })
        };
    }
    async getAttachedFiles(user, partnerId, dto) {
        const { chat } = await this.chatService.findOneByUsersIds([user.id, partnerId]);
        if (!chat)
            throw new common_1.BadRequestException("Chat is not found");
        const messages = await this.messageService.findWithAttachments("files", {
            skip: +dto.skip,
            where: { chat },
            order: {
                createdAt: "DESC"
            }
        });
        return {
            files: messages.reduce((prev, current) => {
                const { id, files, createdAt } = current.public;
                return [
                    ...prev,
                    ...files.map((file) => ({ id, file, createdAt }))
                ];
            }, [])
        };
    }
};
__decorate([
    common_1.Get(),
    __param(0, auth_1.GetUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [users_1.User]),
    __metadata("design:returntype", Promise)
], DirectController.prototype, "getChats", null);
__decorate([
    common_1.Get(":partnerId/messages"),
    __param(0, auth_1.GetUser()),
    __param(1, common_1.Query("partnerId")),
    __param(2, common_1.Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [users_1.User, String, direct_1.GetMessagesDto]),
    __metadata("design:returntype", Promise)
], DirectController.prototype, "getMessages", null);
__decorate([
    common_1.Get(":partnerId"),
    __param(0, auth_1.GetUser()),
    __param(1, common_1.Query("partnerId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [users_1.User, String]),
    __metadata("design:returntype", Promise)
], DirectController.prototype, "getChat", null);
__decorate([
    common_1.Get(":partnerId/attached/images"),
    __param(0, auth_1.GetUser()),
    __param(1, common_1.Query("partnerId")),
    __param(2, common_1.Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [users_1.User, String, direct_1.GetAttachmentsDto]),
    __metadata("design:returntype", Promise)
], DirectController.prototype, "getAttachedImages", null);
__decorate([
    common_1.Get(":partnerId/attached/audios"),
    __param(0, auth_1.GetUser()),
    __param(1, common_1.Query("partnerId")),
    __param(2, common_1.Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [users_1.User, String, direct_1.GetAttachmentsDto]),
    __metadata("design:returntype", Promise)
], DirectController.prototype, "getAttachedAudios", null);
__decorate([
    common_1.Get(":partnerId/attached/files"),
    __param(0, auth_1.GetUser()),
    __param(1, common_1.Query("partnerId")),
    __param(2, common_1.Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [users_1.User, String, direct_1.GetAttachmentsDto]),
    __metadata("design:returntype", Promise)
], DirectController.prototype, "getAttachedFiles", null);
DirectController = __decorate([
    common_1.Controller("directs"),
    __metadata("design:paramtypes", [services_1.DirectMemberService,
        services_1.DirectMessageService,
        services_1.DirectService])
], DirectController);
exports.DirectController = DirectController;
//# sourceMappingURL=direct.controller.js.map