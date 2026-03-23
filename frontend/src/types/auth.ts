import { UserRole } from "./role";

export type AuthUser = {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  role: UserRole;
  isActive: boolean;
};

export type LoginPayload = {
  username: string;
  password: string;
};

