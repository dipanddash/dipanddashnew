import { UserRole } from "./role";

export type Staff = {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateStaffPayload = {
  username: string;
  fullName: string;
  email?: string;
  password: string;
  role: UserRole;
};

export type UpdateStaffPayload = {
  fullName?: string;
  email?: string;
  role?: UserRole;
};

