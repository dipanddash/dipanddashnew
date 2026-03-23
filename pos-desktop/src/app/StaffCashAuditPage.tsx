import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Input,
  SimpleGrid,
  Text,
  Textarea,
  VStack,
  useToast
} from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { cashAuditService } from "@/services/cash-audit.service";
import { CASH_AUDIT_DENOMINATIONS } from "@/types/pos";
import { extractApiErrorMessage } from "@/utils/api-error";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(value);

type CountsState = Record<string, string>;

const createInitialCounts = (): CountsState =>
  Object.fromEntries(CASH_AUDIT_DENOMINATIONS.map((denomination) => [String(denomination), "0"]));

export const StaffCashAuditPage = () => {
  const toast = useToast();

  const [counts, setCounts] = useState<CountsState>(createInitialCounts);
  const [staffCashTakenAmount, setStaffCashTakenAmount] = useState("0");
  const [note, setNote] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [lastAuditAt, setLastAuditAt] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const refreshStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const response = await cashAuditService.getLastAuditInfo();
      setLastAuditAt(response.lastAuditAt);
    } catch (error) {
      toast({
        status: "error",
        title: "Unable to fetch last cash audit",
        description: extractApiErrorMessage(error, "Please try again.")
      });
    } finally {
      setLoadingStatus(false);
    }
  }, [toast]);

  const totalCountedAmount = useMemo(() => {
    const total = CASH_AUDIT_DENOMINATIONS.reduce((sum, denomination) => {
      const count = Number(counts[String(denomination)] || 0);
      const safeCount = Number.isFinite(count) && count > 0 ? count : 0;
      return sum + safeCount * denomination;
    }, 0);
    return Number(total.toFixed(2));
  }, [counts]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const handleSubmit = async () => {
    if (!adminPassword.trim()) {
      toast({
        status: "warning",
        title: "Admin password is required"
      });
      return;
    }

    const parsedCashTaken = Number(staffCashTakenAmount || 0);
    if (!Number.isFinite(parsedCashTaken) || parsedCashTaken < 0) {
      toast({
        status: "warning",
        title: "Enter a valid staff cash taken amount"
      });
      return;
    }

    setSubmitting(true);
    try {
      const normalizedCounts = Object.fromEntries(
        CASH_AUDIT_DENOMINATIONS.map((denomination) => {
          const raw = Number(counts[String(denomination)] || 0);
          const safe = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
          return [String(denomination), safe];
        })
      );

      const response = await cashAuditService.submitEntry({
        denominationCounts: normalizedCounts,
        staffCashTakenAmount: Number(parsedCashTaken.toFixed(2)),
        note: note.trim() || undefined,
        adminPassword: adminPassword.trim()
      });

      toast({
        status: "success",
        title: response.message
      });

      setAdminPassword("");
      setNote("");
      setCounts(createInitialCounts());
      setStaffCashTakenAmount("0");
      await refreshStatus();
    } catch (error) {
      toast({
        status: "error",
        title: "Unable to submit cash audit",
        description: extractApiErrorMessage(error, "Please try again.")
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <VStack align="stretch" spacing={4}>
      <Box p={4} bg="white" borderRadius="14px" border="1px solid rgba(132, 79, 52, 0.2)">
        <Text fontWeight={800}>Last Cash Audit</Text>
        <Text mt={1} color="#6D584E">
          {lastAuditAt
            ? new Date(lastAuditAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
            : "No audit submitted yet."}
        </Text>
        <Button mt={3} variant="outline" size="sm" isLoading={loadingStatus} onClick={() => void refreshStatus()}>
          Refresh Status
        </Button>
      </Box>

      <Box p={4} bg="white" borderRadius="14px" border="1px solid rgba(132, 79, 52, 0.2)">
        <Text fontWeight={900} mb={1}>
          Cash Audit Entry
        </Text>
        <Text color="#6D584E" fontSize="sm" mb={4}>
          Enter denomination counts and staff cash taken. Submission is locked behind admin password confirmation.
        </Text>

        <SimpleGrid columns={{ base: 2, md: 3, xl: 5 }} spacing={3}>
          {CASH_AUDIT_DENOMINATIONS.map((denomination) => (
            <FormControl key={denomination}>
              <FormLabel fontSize="sm" fontWeight={700}>
                ₹{denomination} count
              </FormLabel>
              <Input
                type="number"
                min={0}
                value={counts[String(denomination)] ?? "0"}
                onChange={(event) =>
                  setCounts((previous) => ({
                    ...previous,
                    [String(denomination)]: event.target.value
                  }))
                }
              />
            </FormControl>
          ))}
        </SimpleGrid>

        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3} mt={4}>
          <FormControl>
            <FormLabel fontWeight={700}>Staff Cash Taken</FormLabel>
            <Input
              type="number"
              min={0}
              value={staffCashTakenAmount}
              onChange={(event) => setStaffCashTakenAmount(event.target.value)}
            />
          </FormControl>
          <FormControl>
            <FormLabel fontWeight={700}>Admin Password</FormLabel>
            <Input
              type="password"
              placeholder="Enter admin password for confirmation"
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
            />
          </FormControl>
        </SimpleGrid>

        <FormControl mt={4}>
          <FormLabel fontWeight={700}>Note (Optional)</FormLabel>
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Shift cash note" rows={3} />
        </FormControl>

        <Box
          mt={4}
          p={3}
          borderRadius="10px"
          border="1px solid rgba(132, 79, 52, 0.2)"
          bg="rgba(255, 249, 238, 0.75)"
        >
          <Text color="#705B52" fontSize="sm" fontWeight={700}>
            Total Counted Amount
          </Text>
          <Text mt={1} fontSize="2xl" fontWeight={900} color="#2A1A14">
            {formatCurrency(totalCountedAmount)}
          </Text>
        </Box>

        <Button
          mt={4}
          color="white"
          bgGradient="linear(95deg, #8E0909 0%, #BE3329 46%, #D3A23D 100%)"
          _hover={{ bgGradient: "linear(95deg, #7A0707 0%, #A12822 46%, #BA8A34 100%)" }}
          isLoading={submitting}
          onClick={() => void handleSubmit()}
        >
          Submit Cash Audit
        </Button>
      </Box>
    </VStack>
  );
};
