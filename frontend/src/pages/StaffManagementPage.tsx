import {
  HStack,
  Switch,
  Text,
  useDisclosure,
  VStack,
  useBoolean
} from "@chakra-ui/react";
import { Edit2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PageHeader } from "@/components/common/PageHeader";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { AppButton } from "@/components/ui/AppButton";
import { AppCard } from "@/components/ui/AppCard";
import { DataTable } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SearchInput } from "@/components/common/SearchInput";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ErrorFallback } from "@/components/feedback/ErrorFallback";
import { SkeletonTable } from "@/components/feedback/SkeletonTable";
import { StaffFormModal } from "@/features/staff/components/StaffFormModal";
import { useStaffManagement } from "@/features/staff/hooks/useStaffManagement";
import type { Staff } from "@/types/staff";
import type { UserRole } from "@/types/role";
import { useAppToast } from "@/hooks/useAppToast";
import { extractErrorMessage } from "@/utils/api-error";

export const StaffManagementPage = () => {
  const toast = useAppToast();
  const {
    staff,
    loading,
    mutationLoading,
    error,
    fetchStaff,
    createStaff,
    updateStaff,
    updateStatus
  } = useStaffManagement();

  const [activeSearch, setActiveSearch] = useState("");
  const activeSearchRef = useRef("");
  const [selected, setSelected] = useState<Staff | null>(null);
  const [isStatusChanging, setIsStatusChanging] = useBoolean(false);
  const [pendingStatus, setPendingStatus] = useState<boolean>(false);

  const modalState = useDisclosure();
  const confirmState = useDisclosure();

  const refreshData = useCallback(
    async (search?: string) => {
      try {
        await fetchStaff(search);
      } catch (err) {
        toast.error(extractErrorMessage(err, "Unable to fetch staff data right now"));
      }
    },
    [fetchStaff, toast.error]
  );

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  const openCreate = useCallback(() => {
    setSelected(null);
    modalState.onOpen();
  }, [modalState, setSelected]);

  const handleSearch = useCallback(
    (value: string) => {
      const normalizedValue = value.trim();
      if (activeSearchRef.current === normalizedValue) {
        return;
      }

      activeSearchRef.current = normalizedValue;
      setActiveSearch(normalizedValue);
      void refreshData(normalizedValue);
    },
    [refreshData]
  );

  const openEdit = useCallback(
    (staffMember: Staff) => {
      setSelected(staffMember);
      modalState.onOpen();
    },
    [modalState]
  );

  const submitStaff = useCallback(
    async (values: {
      username?: string;
      fullName: string;
      email?: string;
      role: UserRole;
      password?: string;
    }) => {
      try {
        if (selected) {
          const message = await updateStaff(selected.id, {
            fullName: values.fullName,
            email: values.email,
            role: values.role
          });
          toast.success(message ?? "Staff member updated successfully");
        } else {
          const message = await createStaff({
            username: values.username ?? "",
            fullName: values.fullName,
            email: values.email,
            password: values.password ?? "",
            role: values.role
          });
          toast.success(message ?? "Staff member created successfully");
        }
        modalState.onClose();
      } catch (err) {
        toast.error(extractErrorMessage(err, "Unable to save staff member"));
      }
    },
    [createStaff, modalState, selected, toast, updateStaff]
  );

  const triggerStatusChange = useCallback((staffMember: Staff, isActive: boolean) => {
    setSelected(staffMember);
    setPendingStatus(isActive);
    confirmState.onOpen();
  }, [confirmState]);

  const confirmStatusChange = useCallback(async () => {
    if (!selected) {
      return;
    }
    setIsStatusChanging.on();
    try {
      const message = await updateStatus(selected.id, pendingStatus);
      toast.success(message ?? "Staff status updated successfully");
      confirmState.onClose();
    } catch (err) {
      toast.error(extractErrorMessage(err, "Unable to update staff status"));
    } finally {
      setIsStatusChanging.off();
    }
  }, [confirmState, pendingStatus, selected, setIsStatusChanging, toast, updateStatus]);

  const columns = useMemo(
    () => [
      {
        key: "fullName",
        header: "Name",
        render: (row: Staff) => (
          <VStack align="start" spacing={0}>
            <Text fontWeight={700}>{row.fullName}</Text>
            <Text fontSize="sm" color="gray.500">
              @{row.username}
            </Text>
          </VStack>
        )
      },
      { key: "email", header: "Email" },
      {
        key: "role",
        header: "Role",
        render: (row: Staff) => (
          <Text textTransform="capitalize" fontWeight={600}>
            {row.role.replace("_", " ")}
          </Text>
        )
      },
      {
        key: "status",
        header: "Status",
        render: (row: Staff) => <StatusBadge active={row.isActive} />
      },
      {
        key: "toggle",
        header: "Active Toggle",
        render: (row: Staff) => (
          <Switch
            colorScheme="brand"
            isChecked={row.isActive}
            onChange={(event) => triggerStatusChange(row, event.target.checked)}
          />
        )
      },
      {
        key: "actions",
        header: "Actions",
        render: (row: Staff) => (
          <HStack>
            <ActionIconButton
              aria-label={`Edit ${row.fullName}`}
              icon={<Edit2 size={16} />}
              size="sm"
              variant="outline"
              onClick={() => openEdit(row)}
            />
          </HStack>
        )
      }
    ],
    [openEdit, triggerStatusChange]
  );

  if (error && !staff.length && !loading) {
    return <ErrorFallback title="Unable to Load Staff Data" message={error} onRetry={() => void refreshData()} />;
  }

  return (
    <VStack spacing={6} align="stretch">
      <PageHeader
        title="Staff Management"
        subtitle="Create, edit and manage staff access with role-based control."
        action={
          <AppButton leftIcon={<UserPlus size={16} />} onClick={openCreate}>
            Add Staff
          </AppButton>
        }
      />

      <AppCard>
        <VStack spacing={4} align="stretch">
          <SearchInput
            placeholder="Search by name or username..."
            onDebouncedChange={handleSearch}
          />
          {loading ? (
            <SkeletonTable />
          ) : (
            <DataTable
              columns={columns}
              rows={staff}
              emptyState={
                <EmptyState
                  title="No staff members found"
                  description={
                    activeSearch
                      ? "Try adjusting your search to find staff results."
                      : "Create your first staff member to begin role-based operations."
                  }
                />
              }
            />
          )}
        </VStack>
      </AppCard>

      <StaffFormModal
        isOpen={modalState.isOpen}
        onClose={() => {
          modalState.onClose();
          setSelected(null);
        }}
        mode={selected ? "edit" : "create"}
        initialData={selected}
        onSubmit={submitStaff}
        loading={mutationLoading}
      />

      <ConfirmDialog
        isOpen={confirmState.isOpen}
        onClose={confirmState.onClose}
        title="Confirm Status Change"
        description={`Are you sure you want to ${pendingStatus ? "activate" : "deactivate"} ${
          selected?.fullName ?? "this staff member"
        }?`}
        onConfirm={() => void confirmStatusChange()}
        isLoading={isStatusChanging}
      />
    </VStack>
  );
};
