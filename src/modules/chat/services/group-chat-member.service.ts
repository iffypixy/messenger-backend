import {Injectable} from "@nestjs/common";
import {InjectRepository} from "@nestjs/typeorm";
import {
  DeepPartial,
  FindManyOptions,
  FindOneOptions,
  Repository
} from "typeorm";

import {GroupChatMember} from "../entities";

@Injectable()
export class GroupChatMemberService {
  constructor(
    @InjectRepository(GroupChatMember)
    private readonly memberRepository: Repository<GroupChatMember>
  ) {}

  create(partial: DeepPartial<GroupChatMember>): Promise<GroupChatMember> {
    const member = this.memberRepository.create(partial);

    return this.memberRepository.save(member);
  }

  find(options: FindManyOptions<GroupChatMember>): Promise<GroupChatMember[]> {
    return this.memberRepository.find(options);
  }

  findOne(options: FindOneOptions<GroupChatMember>): Promise<GroupChatMember> {
    return this.memberRepository.findOne(options);
  }
}