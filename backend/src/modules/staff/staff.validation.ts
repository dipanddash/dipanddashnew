import { z } from "zod";

import { UserRole } from "../../constants/roles";

const restrictedRoleSchema = z
  .nativeEnum(UserRole)
  .refine((role) => role !== UserRole.ADMIN, "Admin role cannot be assigned in staff management");

export const createStaffSchema = z.object({
  body: z.object({
    username: z
      .string()
      .trim()
      .min(3, "Username must be at least 3 characters")
      .max(50, "Username cannot exceed 50 characters"),
    fullName: z
      .string()
      .trim()
      .min(2, "Full name must be at least 2 characters")
      .max(120, "Full name cannot exceed 120 characters"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Password must contain letters and numbers"),
    email: z
      .string()
      .trim()
      .email("Please provide a valid email address")
      .optional()
      .or(z.literal("")),
    role: restrictedRoleSchema
  })
});

export const updateStaffSchema = z.object({
  params: z.object({
    id: z.string().uuid("Invalid staff id")
  }),
  body: z
    .object({
      fullName: z
        .string()
        .trim()
        .min(2, "Full name must be at least 2 characters")
        .max(120, "Full name cannot exceed 120 characters")
        .optional(),
      email: z
        .string()
        .trim()
        .email("Please provide a valid email address")
        .optional()
        .or(z.literal("")),
      role: restrictedRoleSchema.optional()
    })
    .refine((value) => Object.keys(value).length > 0, "At least one field must be provided")
});

export const updateStaffStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid("Invalid staff id")
  }),
  body: z.object({
    isActive: z.boolean()
  })
});

export const staffListQuerySchema = z.object({
  query: z.object({
    search: z.string().trim().optional()
  })
});
