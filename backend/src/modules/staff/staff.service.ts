import { UserRole } from "../../constants/roles";
import { hashPassword } from "../../utils/password";
import { UserService } from "../users/user.service";

export class StaffService {
  private readonly userService = new UserService();

  async listStaff(search?: string) {
    const users = await this.userService.listStaff(search);
    return users.map((user) => ({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    }));
  }

  async createStaff(payload: {
    username: string;
    fullName: string;
    password: string;
    email?: string;
    role: UserRole;
  }) {
    const passwordHash = await hashPassword(payload.password);
    return this.userService.createStaff({
      username: payload.username.toLowerCase(),
      fullName: payload.fullName,
      email: payload.email ? payload.email.toLowerCase() : null,
      passwordHash,
      role: payload.role,
      isActive: true
    });
  }

  async updateStaff(
    id: string,
    payload: {
      fullName?: string;
      email?: string;
      role?: UserRole;
    }
  ) {
    return this.userService.updateStaff(id, {
      fullName: payload.fullName,
      email: payload.email ? payload.email.toLowerCase() : payload.email,
      role: payload.role
    });
  }

  async updateStatus(id: string, isActive: boolean) {
    return this.userService.updateStaffStatus(id, isActive);
  }
}

