import { NestMiddleware } from "@nestjs/common";
import { NextFunction, Response } from "express";
import { UsersService } from "@modules/users";
import { ExtendedRequest } from "@lib/typings";
import { AuthService } from "../services";
export declare class AuthMiddleware implements NestMiddleware {
    private readonly authService;
    private readonly userService;
    constructor(authService: AuthService, userService: UsersService);
    use(req: ExtendedRequest, res: Response, next: NextFunction): Promise<void>;
}
