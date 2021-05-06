import {Column, Entity, ManyToOne, PrimaryGeneratedColumn} from "typeorm";

import {User} from "@modules/user";
import {ID} from "@lib/typings";
import {FilePublicData} from "../lib/typings";

@Entity()
export class File {
  @PrimaryGeneratedColumn("uuid")
  id: ID;

  @Column( {
    type: "varchar",
    nullable: false,
    length: 256
  })
  name: string;

  @Column({
    type: "integer",
    nullable: false
  })
  size: number;

  @Column( {
    type: "varchar",
    nullable: false,
    length: 8
  })
  extension: string;

  @Column( {
    type: "text",
    nullable: false
  })
  url: string;

  @ManyToOne(() => User, {
    cascade: true,
    eager: true,
    nullable: false
  })
  user: User;

  get public(): FilePublicData {
    const {id, name, size, url} = this;

    return {id, name, size, url};
  }
}
