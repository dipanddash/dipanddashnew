import { UserRole } from "../../constants/roles";
import { hashPassword } from "../../utils/password";
import { UserService } from "../users/user.service";
import { REPORT_KEYS, type ReportKey } from "../reports/reports.constants";

export class StaffService {
  private readonly userService = new UserService();

  private sanitizeAssignedReports(assignedReports?: string[]): ReportKey[] {
    if (!assignedReports?.length) {
      return [];
    }

    const allowed = new Set(REPORT_KEYS);
    const unique = new Set<ReportKey>();
    assignedReports.forEach((key) => {
      if (allowed.has(key as ReportKey)) {
        unique.add(key as ReportKey);
      }
    });
    return [...unique];
  }

  async listStaff(search?: string) {
    const users = await this.userService.listStaff(search);
    return users.map((user) => ({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      assignedReports: user.assignedReports ?? [],
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
    assignedReports?: string[];
  }) {
    const passwordHash = await hashPassword(payload.password);
    return this.userService.createStaff({
      username: payload.username.toLowerCase(),
      fullName: payload.fullName,
      email: payload.email ? payload.email.toLowerCase() : null,
      passwordHash,
      role: payload.role,
      isActive: true,
      assignedReports: this.sanitizeAssignedReports(payload.assignedReports)
    });
  }

  async updateStaff(
    id: string,
    payload: {
      fullName?: string;
      email?: string;
      role?: UserRole;
      assignedReports?: string[];
    }
  ) {
    return this.userService.updateStaff(id, {
      fullName: payload.fullName,
      email: payload.email ? payload.email.toLowerCase() : payload.email,
      role: payload.role,
      assignedReports:
        payload.assignedReports === undefined
          ? undefined
          : this.sanitizeAssignedReports(payload.assignedReports)
    });
  }

  async updateStatus(id: string, isActive: boolean) {
    return this.userService.updateStaffStatus(id, isActive);
  }

  async resetPassword(id: string, password: string) {
    const passwordHash = await hashPassword(password);
    return this.userService.resetStaffPassword(id, passwordHash);
  }
}
