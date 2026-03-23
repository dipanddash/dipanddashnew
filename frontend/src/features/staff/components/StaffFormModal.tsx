import {
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  VStack
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { AppButton } from "@/components/ui/AppButton";
import { AppInput } from "@/components/ui/AppInput";
import { AppPasswordInput } from "@/components/ui/AppPasswordInput";
import { AppSelect } from "@/components/ui/AppSelect";
import { useModalCloseGuard } from "@/hooks/useModalCloseGuard";
import { UserRole } from "@/types/role";
import type { Staff } from "@/types/staff";

const createSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email").optional().or(z.literal("")),
  role: z.nativeEnum(UserRole).refine((role) => role !== UserRole.ADMIN, "Admin role is not allowed"),
  password: z.string().min(8, "Password must be at least 8 characters")
});

const updateSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email").optional().or(z.literal("")),
  role: z.nativeEnum(UserRole).refine((role) => role !== UserRole.ADMIN, "Admin role is not allowed")
});

type StaffFormValues = {
  username: string;
  fullName: string;
  email: string;
  role: UserRole;
  password: string;
};

type StaffFormModalProps = {
  isOpen: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  initialData?: Staff | null;
  onSubmit: (values: {
    username?: string;
    fullName: string;
    email?: string;
    role: UserRole;
    password?: string;
  }) => Promise<void>;
  loading?: boolean;
};

const roleOptions = [
  { label: "Manager", value: UserRole.MANAGER },
  { label: "Accountant", value: UserRole.ACCOUNTANT },
  { label: "Staff", value: UserRole.STAFF },
  { label: "Snooker Staff", value: UserRole.SNOOKER_STAFF }
];

export const StaffFormModal = ({
  isOpen,
  onClose,
  mode,
  initialData,
  onSubmit,
  loading
}: StaffFormModalProps) => {
  const isCreate = mode === "create";
  const schema = isCreate ? createSchema : updateSchema;
  const { isCloseConfirmOpen, requestClose, cancelCloseRequest, confirmClose } = useModalCloseGuard(onClose);

  const {
    register,
    reset,
    handleSubmit,
    formState: { errors }
  } = useForm<StaffFormValues>({
    resolver: zodResolver(schema as z.ZodTypeAny),
    defaultValues: {
      username: "",
      fullName: "",
      email: "",
      role: UserRole.STAFF,
      password: ""
    }
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (initialData) {
      reset({
        username: initialData.username,
        fullName: initialData.fullName,
        email: initialData.email ?? "",
        role: initialData.role,
        password: ""
      });
      return;
    }

    reset({
      username: "",
      fullName: "",
      email: "",
      role: UserRole.STAFF,
      password: ""
    });
  }, [initialData, isOpen, reset]);

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={requestClose}
        isCentered
        size="lg"
        closeOnOverlayClick={false}
        closeOnEsc={false}
      >
      <ModalOverlay />
      <ModalContent borderRadius="16px">
        <ModalHeader>{isCreate ? "Create Staff Member" : "Update Staff Member"}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack
            as="form"
            id="staff-form"
            spacing={4}
            align="stretch"
            onSubmit={handleSubmit(onSubmit)}
          >
            {isCreate ? (
              <>
                <AppInput
                  label="Username"
                  placeholder="e.g. counter_01"
                  error={errors.username?.message as string | undefined}
                  {...register("username")}
                />
                <AppPasswordInput
                  label="Password"
                  placeholder="Create password"
                  error={errors.password?.message as string | undefined}
                  {...register("password")}
                />
              </>
            ) : null}
            <AppInput
              label="Full Name"
              placeholder="e.g. John Doe"
              error={errors.fullName?.message as string | undefined}
              {...register("fullName")}
            />
            <AppInput
              label="Email (Optional)"
              placeholder="name@dipanddash.com"
              error={errors.email?.message as string | undefined}
              {...register("email")}
            />
            <AppSelect
              label="Role"
              options={roleOptions}
              error={errors.role?.message as string | undefined}
              {...register("role")}
            />
          </VStack>
        </ModalBody>
        <ModalFooter gap={3}>
          <AppButton variant="outline" onClick={requestClose}>
            Cancel
          </AppButton>
          <AppButton type="submit" form="staff-form" isLoading={loading}>
            {isCreate ? "Create Staff" : "Save Changes"}
          </AppButton>
        </ModalFooter>
      </ModalContent>
      </Modal>
      <ConfirmDialog
        isOpen={isCloseConfirmOpen}
        title="Close this popup?"
        description="Are you sure you want to close? Unsaved changes will be lost."
        onClose={cancelCloseRequest}
        onConfirm={confirmClose}
      />
    </>
  );
};
