import {
  Box,
  FormControl,
  FormLabel,
  HStack,
  Input,
  SimpleGrid,
  Select,
  Switch,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  VStack,
  useDisclosure
} from "@chakra-ui/react";
import { Edit2, Eye, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { PageHeader } from "@/components/common/PageHeader";
import { SkeletonTable } from "@/components/feedback/SkeletonTable";
import { AppCard } from "@/components/ui/AppCard";
import { AppButton } from "@/components/ui/AppButton";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { AppInput } from "@/components/ui/AppInput";
import { DataTable } from "@/components/ui/DataTable";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useAppToast } from "@/hooks/useAppToast";
import { CategoryFormModal } from "@/features/ingredients/components/CategoryFormModal";
import { IngredientFormModal } from "@/features/ingredients/components/IngredientFormModal";
import { StockDetailsModal } from "@/features/ingredients/components/StockDetailsModal";
import { ingredientsService } from "@/services/ingredients.service";
import type {
  AllocationRow,
  IngredientCategory,
  IngredientListItem,
  IngredientStockDetails,
  IngredientStockLog,
  IngredientAllocationStats,
  PosBillingControl,
  IngredientUnit,
  PaginationData
} from "@/types/ingredient";
import { extractErrorMessage } from "@/utils/api-error";
import { formatQuantity, formatQuantityWithUnit } from "@/utils/quantity";

const getTodayDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getPreviousDateString = (date: string) => {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  parsed.setDate(parsed.getDate() - 1);
  return parsed.toISOString().slice(0, 10);
};

const defaultPagination: PaginationData = {
  page: 1,
  limit: 5,
  total: 0,
  totalPages: 1
};

const PaginationControls = ({
  page,
  totalPages,
  total,
  showing,
  onPageChange
}: {
  page: number;
  totalPages: number;
  total: number;
  showing: number;
  onPageChange: (page: number) => void;
}) => (
  <HStack justify="space-between" mt={4} flexWrap="wrap" gap={3}>
    <Text color="#705B52" fontSize="sm">
      Showing {showing} of {total} records
    </Text>
    <HStack>
      <AppButton variant="outline" isDisabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        Previous
      </AppButton>
      <Text fontWeight={700}>
        Page {page} of {totalPages}
      </Text>
      <AppButton variant="outline" isDisabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        Next
      </AppButton>
    </HStack>
  </HStack>
);

const statusBadge = (status: "LOW_STOCK" | "OK") => (
  <Box
    px={3}
    py={1}
    borderRadius="full"
    fontSize="xs"
    fontWeight={700}
    bg={status === "LOW_STOCK" ? "red.100" : "green.100"}
    color={status === "LOW_STOCK" ? "red.700" : "green.700"}
    w="fit-content"
  >
    {status === "LOW_STOCK" ? "Low Stock" : "Healthy"}
  </Box>
);

const chartColors = ["#B91C1C", "#16A34A", "#D97706", "#7C2D12", "#C2410C", "#15803D"];

const StatsMetricCard = ({
  label,
  value,
  helper
}: {
  label: string;
  value: string;
  helper?: string;
}) => (
  <Box
    p={4}
    borderRadius="18px"
    border="1px solid"
    borderColor="rgba(133, 78, 48, 0.24)"
    bg="linear-gradient(180deg, #FFFFFF 0%, #FFF7EA 100%)"
    boxShadow="0 10px 18px rgba(72, 29, 11, 0.08)"
    minH="118px"
    position="relative"
    overflow="hidden"
  >
    <Box
      position="absolute"
      right="-18px"
      top="-18px"
      w="60px"
      h="60px"
      bg="radial-gradient(circle, rgba(217,119,6,0.26) 0%, rgba(217,119,6,0) 70%)"
      pointerEvents="none"
    />
    <Text fontSize="sm" color="#7A6258" fontWeight={600}>
      {label}
    </Text>
    <Text mt={2} fontSize="2xl" fontWeight={900} color="#2A1A14">
      {value}
    </Text>
    {helper ? (
      <Text mt={1} fontSize="xs" color="#8A6F63">
        {helper}
      </Text>
    ) : null}
  </Box>
);

export const IngredientEntryPage = () => {
  const toast = useAppToast();

  const [allCategories, setAllCategories] = useState<IngredientCategory[]>([]);

  const [categoryRows, setCategoryRows] = useState<IngredientCategory[]>([]);
  const [categoryPagination, setCategoryPagination] = useState<PaginationData>(defaultPagination);
  const [categoryLoading, setCategoryLoading] = useState(true);
  const [categoryMutationLoading, setCategoryMutationLoading] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const debouncedCategorySearch = useDebouncedValue(categorySearch, 400);
  const [categoryPage, setCategoryPage] = useState(1);
  const [categoryLimit, setCategoryLimit] = useState(5);
  const [selectedCategory, setSelectedCategory] = useState<IngredientCategory | null>(null);

  const categoryModal = useDisclosure();
  const deleteCategoryDialog = useDisclosure();

  const [ingredientRows, setIngredientRows] = useState<IngredientListItem[]>([]);
  const [ingredientPagination, setIngredientPagination] = useState<PaginationData>(defaultPagination);
  const [ingredientLoading, setIngredientLoading] = useState(true);
  const [ingredientMutationLoading, setIngredientMutationLoading] = useState(false);
  const [ingredientSearch, setIngredientSearch] = useState("");
  const debouncedIngredientSearch = useDebouncedValue(ingredientSearch, 400);
  const [ingredientCategoryFilter, setIngredientCategoryFilter] = useState("");
  const [ingredientPage, setIngredientPage] = useState(1);
  const [ingredientLimit, setIngredientLimit] = useState(5);
  const [selectedIngredient, setSelectedIngredient] = useState<IngredientListItem | null>(null);

  const ingredientModal = useDisclosure();
  const deleteIngredientDialog = useDisclosure();
  const stockDetailsModal = useDisclosure();
  const [stockDetailsLoading, setStockDetailsLoading] = useState(false);
  const [stockDetails, setStockDetails] = useState<IngredientStockDetails | null>(null);
  const [stockLogs, setStockLogs] = useState<IngredientStockLog[]>([]);

  const [allocationRows, setAllocationRows] = useState<AllocationRow[]>([]);
  const [allocationPagination, setAllocationPagination] = useState<PaginationData>(defaultPagination);
  const [allocationLoading, setAllocationLoading] = useState(true);
  const [allocationSearch, setAllocationSearch] = useState("");
  const debouncedAllocationSearch = useDebouncedValue(allocationSearch, 400);
  const [allocationCategoryFilter, setAllocationCategoryFilter] = useState("");
  const [allocationDate, setAllocationDate] = useState(getTodayDate());
  const [allocationPage, setAllocationPage] = useState(1);
  const [allocationLimit, setAllocationLimit] = useState(5);
  const [allocationDrafts, setAllocationDrafts] = useState<Record<string, string>>({});
  const [usageDrafts, setUsageDrafts] = useState<Record<string, string>>({});
  const [rowActionLoading, setRowActionLoading] = useState<Record<string, boolean>>({});
  const [statsRows, setStatsRows] = useState<AllocationRow[]>([]);
  const [statsPagination, setStatsPagination] = useState<PaginationData>(defaultPagination);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsSearch, setStatsSearch] = useState("");
  const debouncedStatsSearch = useDebouncedValue(statsSearch, 400);
  const [statsCategoryFilter, setStatsCategoryFilter] = useState("");
  const [statsPage, setStatsPage] = useState(1);
  const [statsLimit, setStatsLimit] = useState(8);
  const [allocationStats, setAllocationStats] = useState<IngredientAllocationStats | null>(null);
  const [allocationStatsLoading, setAllocationStatsLoading] = useState(true);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [posBillingControl, setPosBillingControl] = useState<PosBillingControl | null>(null);
  const [posControlLoading, setPosControlLoading] = useState(false);
  const assignAllDialog = useDisclosure();
  const continueYesterdayDialog = useDisclosure();
  const posControlDialog = useDisclosure();

  const fetchCategoryOptions = useCallback(async () => {
    try {
      const limit = 50;
      let page = 1;
      let totalPages = 1;
      const collected: IngredientCategory[] = [];

      while (page <= totalPages) {
        const response = await ingredientsService.getCategories({ page, limit });
        collected.push(...response.data.categories);
        totalPages = response.data.pagination.totalPages;
        page += 1;
      }

      setAllCategories(collected);
    } catch (error) {
      toast.error(extractErrorMessage(error, "Unable to fetch category options."));
    }
  }, [toast]);

  const fetchCategories = useCallback(async () => {
    setCategoryLoading(true);
    try {
      const response = await ingredientsService.getCategories({
        includeInactive: true,
        search: debouncedCategorySearch || undefined,
        page: categoryPage,
        limit: categoryLimit
      });
      setCategoryRows(response.data.categories);
      setCategoryPagination(response.data.pagination);
    } catch (error) {
      toast.error(extractErrorMessage(error, "Unable to fetch categories."));
    } finally {
      setCategoryLoading(false);
    }
  }, [categoryLimit, categoryPage, debouncedCategorySearch, toast]);

  const fetchIngredients = useCallback(async () => {
    setIngredientLoading(true);
    try {
      const response = await ingredientsService.getIngredients({
        search: debouncedIngredientSearch || undefined,
        categoryId: ingredientCategoryFilter || undefined,
        includeInactive: true,
        page: ingredientPage,
        limit: ingredientLimit
      });
      setIngredientRows(response.data.ingredients);
      setIngredientPagination(response.data.pagination);
    } catch (error) {
      toast.error(extractErrorMessage(error, "Unable to fetch ingredients."));
    } finally {
      setIngredientLoading(false);
    }
  }, [debouncedIngredientSearch, ingredientCategoryFilter, ingredientLimit, ingredientPage, toast]);

  const fetchAllocations = useCallback(async () => {
    setAllocationLoading(true);
    try {
      const response = await ingredientsService.getAllocations({
        date: allocationDate,
        search: debouncedAllocationSearch || undefined,
        categoryId: allocationCategoryFilter || undefined,
        page: allocationPage,
        limit: allocationLimit
      });
      setAllocationRows(response.data.rows);
      setAllocationPagination(response.data.pagination);
      setAllocationDrafts(
        response.data.rows.reduce<Record<string, string>>((accumulator, row) => {
          accumulator[row.ingredientId] = String(row.allocatedQuantity);
          return accumulator;
        }, {})
      );
      setUsageDrafts(
        response.data.rows.reduce<Record<string, string>>((accumulator, row) => {
          accumulator[row.ingredientId] = String(row.usedQuantity);
          return accumulator;
        }, {})
      );
    } catch (error) {
      toast.error(extractErrorMessage(error, "Unable to fetch allocation data."));
    } finally {
      setAllocationLoading(false);
    }
  }, [
    allocationCategoryFilter,
    allocationDate,
    allocationLimit,
    allocationPage,
    debouncedAllocationSearch,
    toast
  ]);

  const fetchStatsRows = useCallback(async () => {
    setStatsLoading(true);
    try {
      const response = await ingredientsService.getAllocations({
        date: allocationDate,
        search: debouncedStatsSearch || undefined,
        categoryId: statsCategoryFilter || undefined,
        page: statsPage,
        limit: statsLimit
      });
      setStatsRows(response.data.rows);
      setStatsPagination(response.data.pagination);
    } catch (error) {
      toast.error(extractErrorMessage(error, "Unable to fetch stats table."));
    } finally {
      setStatsLoading(false);
    }
  }, [allocationDate, debouncedStatsSearch, statsCategoryFilter, statsLimit, statsPage, toast]);

  const fetchAllocationStats = useCallback(async () => {
    setAllocationStatsLoading(true);
    try {
      const response = await ingredientsService.getAllocationStats({
        date: allocationDate,
        search: debouncedStatsSearch || undefined,
        categoryId: statsCategoryFilter || undefined
      });
      setAllocationStats(response.data);
    } catch (error) {
      toast.error(extractErrorMessage(error, "Unable to fetch stock analytics."));
    } finally {
      setAllocationStatsLoading(false);
    }
  }, [allocationDate, debouncedStatsSearch, statsCategoryFilter, toast]);

  const fetchPosBillingControl = useCallback(async () => {
    try {
      const response = await ingredientsService.getPosBillingControl();
      setPosBillingControl(response.data);
    } catch (error) {
      toast.error(extractErrorMessage(error, "Unable to fetch POS billing control."));
    }
  }, [toast]);

  useEffect(() => {
    void fetchCategoryOptions();
  }, [fetchCategoryOptions]);

  useEffect(() => {
    void fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    void fetchIngredients();
  }, [fetchIngredients]);

  useEffect(() => {
    void fetchAllocations();
  }, [fetchAllocations]);

  useEffect(() => {
    void fetchAllocationStats();
  }, [fetchAllocationStats]);

  useEffect(() => {
    void fetchStatsRows();
  }, [fetchStatsRows]);

  useEffect(() => {
    void fetchPosBillingControl();
  }, [fetchPosBillingControl]);

  useEffect(() => {
    setCategoryPage(1);
  }, [debouncedCategorySearch]);

  useEffect(() => {
    setIngredientPage(1);
  }, [debouncedIngredientSearch, ingredientCategoryFilter]);

  useEffect(() => {
    setAllocationPage(1);
  }, [allocationCategoryFilter, allocationDate, debouncedAllocationSearch]);

  useEffect(() => {
    setStatsPage(1);
  }, [allocationDate, debouncedStatsSearch, statsCategoryFilter]);

  const categoryOptions = useMemo(
    () => allCategories.map((category) => ({ label: category.name, value: category.id })),
    [allCategories]
  );

  const handleCategorySubmit = useCallback(
    async (values: { name: string; description?: string }) => {
      setCategoryMutationLoading(true);
      try {
        if (selectedCategory) {
          const response = await ingredientsService.updateCategory(selectedCategory.id, values);
          toast.success(response.message);
        } else {
          const response = await ingredientsService.createCategory(values);
          toast.success(response.message);
        }

        categoryModal.onClose();
        await Promise.all([
          fetchCategories(),
          fetchCategoryOptions(),
          fetchIngredients(),
          fetchAllocations(),
          fetchAllocationStats(),
          fetchStatsRows()
        ]);
      } catch (error) {
        toast.error(extractErrorMessage(error, "Unable to save category."));
      } finally {
        setCategoryMutationLoading(false);
      }
    },
    [
      categoryModal,
      fetchAllocations,
      fetchCategories,
      fetchCategoryOptions,
      fetchIngredients,
      selectedCategory,
      toast
    ]
  );

  const handleDeleteCategory = useCallback(async () => {
    if (!selectedCategory) {
      return;
    }
    if ((selectedCategory.ingredientCount ?? 0) > 0) {
      toast.warning("This category has ingredients. Move or delete ingredients first.");
      deleteCategoryDialog.onClose();
      return;
    }

    setCategoryMutationLoading(true);
    try {
      const response = await ingredientsService.deleteCategory(selectedCategory.id);
      toast.success(response.message);
      deleteCategoryDialog.onClose();
      await Promise.all([
        fetchCategories(),
        fetchCategoryOptions(),
        fetchIngredients(),
        fetchAllocations(),
        fetchAllocationStats(),
        fetchStatsRows()
      ]);
    } catch (error) {
      toast.error(extractErrorMessage(error, "Unable to delete category."));
    } finally {
      setCategoryMutationLoading(false);
    }
  }, [
    deleteCategoryDialog,
    fetchAllocations,
    fetchCategories,
    fetchCategoryOptions,
    fetchIngredients,
    selectedCategory,
    toast
  ]);

  const handleIngredientSubmit = useCallback(
    async (values: {
      name: string;
      categoryId: string;
      unit: IngredientUnit;
      perUnitPrice: number;
      minStock: number;
      currentStock?: number;
    }) => {
      setIngredientMutationLoading(true);
      try {
        const { currentStock, ...basePayload } = values;
        if (selectedIngredient) {
          const response = await ingredientsService.updateIngredient(selectedIngredient.id, {
            ...basePayload,
            currentStock
          });
          toast.success(response.message);
        } else {
          const response = await ingredientsService.createIngredient({
            ...basePayload,
            currentStock: currentStock ?? 0
          });
          toast.success(response.message);
        }

        ingredientModal.onClose();
        await Promise.all([fetchIngredients(), fetchAllocations(), fetchAllocationStats(), fetchStatsRows()]);
      } catch (error) {
        toast.error(extractErrorMessage(error, "Unable to save ingredient."));
      } finally {
        setIngredientMutationLoading(false);
      }
    },
    [fetchAllocations, fetchIngredients, ingredientModal, selectedIngredient, toast]
  );

  const handleDeleteIngredient = useCallback(async () => {
    if (!selectedIngredient) {
      return;
    }

    setIngredientMutationLoading(true);
    try {
      const response = await ingredientsService.deleteIngredient(selectedIngredient.id);
      toast.success(response.message);
      deleteIngredientDialog.onClose();
      await Promise.all([fetchIngredients(), fetchAllocations(), fetchAllocationStats(), fetchStatsRows()]);
    } catch (error) {
      toast.error(extractErrorMessage(error, "Unable to delete ingredient."));
    } finally {
      setIngredientMutationLoading(false);
    }
  }, [deleteIngredientDialog, fetchAllocations, fetchIngredients, selectedIngredient, toast]);

  const openStockDetails = useCallback(
    async (ingredient: IngredientListItem) => {
      setStockDetails(null);
      setStockLogs([]);
      setStockDetailsLoading(true);
      stockDetailsModal.onOpen();

      try {
        const response = await ingredientsService.getIngredientStock(ingredient.id, { page: 1, limit: 20 });
        setStockDetails(response.data.stock);
        setStockLogs(response.data.logs);
      } catch (error) {
        toast.error(extractErrorMessage(error, "Unable to fetch stock details."));
      } finally {
        setStockDetailsLoading(false);
      }
    },
    [stockDetailsModal, toast]
  );

  const runRowAction = useCallback(async (key: string, action: () => Promise<void>) => {
    setRowActionLoading((previous) => ({ ...previous, [key]: true }));
    try {
      await action();
    } finally {
      setRowActionLoading((previous) => ({ ...previous, [key]: false }));
    }
  }, []);

  const handleToggleIngredientStatus = useCallback(
    async (ingredient: IngredientListItem, nextIsActive: boolean) => {
      await runRowAction(`active-${ingredient.id}`, async () => {
        try {
          const response = await ingredientsService.updateIngredient(ingredient.id, { isActive: nextIsActive });
          toast.success(response.message);
          await Promise.all([fetchIngredients(), fetchAllocations(), fetchAllocationStats(), fetchStatsRows()]);
        } catch (error) {
          toast.error(
            extractErrorMessage(
              error,
              nextIsActive ? "Unable to enable ingredient." : "Unable to disable ingredient."
            )
          );
        }
      });
    },
    [fetchAllocations, fetchIngredients, runRowAction, toast]
  );

  const handleSaveAllocation = useCallback(
    async (row: AllocationRow) => {
      const draftValue = Number(allocationDrafts[row.ingredientId]);
      if (!Number.isFinite(draftValue) || draftValue < 0) {
        toast.warning("Allocated quantity must be a valid non-negative number.");
        return;
      }

      await runRowAction(`alloc-${row.ingredientId}`, async () => {
        try {
          const response = await ingredientsService.saveAllocation({
            ingredientId: row.ingredientId,
            date: allocationDate,
            allocatedQuantity: draftValue
          });
          toast.success(response.message);
          await Promise.all([fetchAllocations(), fetchIngredients(), fetchStatsRows(), fetchAllocationStats()]);
        } catch (error) {
          toast.error(extractErrorMessage(error, "Unable to save allocation."));
        }
      });
    },
    [
      allocationDate,
      allocationDrafts,
      fetchAllocations,
      fetchIngredients,
      fetchStatsRows,
      fetchAllocationStats,
      runRowAction,
      toast
    ]
  );

  const handleSaveUsage = useCallback(
    async (row: AllocationRow) => {
      const allocationId = row.allocationId;
      if (!allocationId) {
        toast.warning("Please save allocation first before updating used quantity.");
        return;
      }

      const draftValue = Number(usageDrafts[row.ingredientId]);
      if (!Number.isFinite(draftValue) || draftValue < 0) {
        toast.warning("Used quantity must be a valid non-negative number.");
        return;
      }

      await runRowAction(`use-${row.ingredientId}`, async () => {
        try {
          const response = await ingredientsService.updateAllocation(allocationId, {
            usedQuantity: draftValue
          });
          toast.success(response.message);
          await Promise.all([fetchAllocations(), fetchStatsRows(), fetchAllocationStats()]);
        } catch (error) {
          toast.error(extractErrorMessage(error, "Unable to update used quantity."));
        }
      });
    },
    [fetchAllocations, fetchStatsRows, fetchAllocationStats, runRowAction, toast, usageDrafts]
  );

  const handleAssignAllStock = useCallback(async () => {
    setBulkActionLoading(true);
    try {
      const response = await ingredientsService.assignAllStockToDate({
        date: allocationDate
      });
      toast.success(
        `${response.message} Allocated: ${response.data.summary.allocatedCount}, skipped: ${response.data.summary.skippedCount}.`
      );
      assignAllDialog.onClose();
      await Promise.all([fetchAllocations(), fetchIngredients(), fetchAllocationStats(), fetchStatsRows()]);
    } catch (error) {
      toast.error(extractErrorMessage(error, "Unable to allocate all available stock."));
    } finally {
      setBulkActionLoading(false);
    }
  }, [
    allocationDate,
    assignAllDialog,
    fetchAllocationStats,
    fetchAllocations,
    fetchIngredients,
    fetchStatsRows,
    toast
  ]);

  const handleContinueYesterday = useCallback(async () => {
    setBulkActionLoading(true);
    try {
      const response = await ingredientsService.continueYesterdayAllocation({
        date: allocationDate
      });
      toast.success(
        `${response.message} Copied: ${response.data.summary.copiedCount}, partial: ${response.data.summary.partialCount}, skipped: ${response.data.summary.skippedCount}.`
      );
      continueYesterdayDialog.onClose();
      await Promise.all([fetchAllocations(), fetchIngredients(), fetchAllocationStats(), fetchStatsRows()]);
    } catch (error) {
      toast.error(extractErrorMessage(error, "Unable to continue yesterday allocation."));
    } finally {
      setBulkActionLoading(false);
    }
  }, [
    allocationDate,
    continueYesterdayDialog,
    fetchAllocationStats,
    fetchAllocations,
    fetchIngredients,
    fetchStatsRows,
    toast
  ]);

  const handleTogglePosBillingControl = useCallback(async () => {
    if (!posBillingControl) {
      return;
    }

    setPosControlLoading(true);
    try {
      const nextEnabled = !posBillingControl.isBillingEnabled;
      const response = await ingredientsService.updatePosBillingControl({
        isBillingEnabled: nextEnabled,
        reason: nextEnabled ? "" : "Paused by admin from Ingredient Stock & Allocation control."
      });
      setPosBillingControl(response.data);
      posControlDialog.onClose();
      toast.success(
        nextEnabled
          ? "POS billing is enabled. Staff can take orders now."
          : "POS billing is paused. Staff cannot take new orders."
      );
    } catch (error) {
      toast.error(extractErrorMessage(error, "Unable to update POS billing control."));
    } finally {
      setPosControlLoading(false);
    }
  }, [posBillingControl, posControlDialog, toast]);

  const categoryColumns = useMemo(
    () =>
      [
        { key: "name", header: "Category Name" },
        {
          key: "description",
          header: "Description",
          render: (row: IngredientCategory) => row.description || "-"
        },
        {
          key: "ingredientCount",
          header: "Ingredients",
          render: (row: IngredientCategory) => (
            <Text fontWeight={700} color={(row.ingredientCount ?? 0) > 0 ? "#5B3A2A" : "#7D655B"}>
              {row.ingredientCount ?? 0}
            </Text>
          )
        },
        {
          key: "status",
          header: "Status",
          render: (row: IngredientCategory) => (
            <Box
              px={3}
              py={1}
              borderRadius="full"
              fontSize="xs"
              fontWeight={700}
              bg={row.isActive ? "green.100" : "gray.100"}
              color={row.isActive ? "green.700" : "gray.600"}
              w="fit-content"
            >
              {row.isActive ? "Active" : "Inactive"}
            </Box>
          )
        },
        {
          key: "actions",
          header: "Actions",
          render: (row: IngredientCategory) => (
            <HStack>
              <ActionIconButton
                aria-label={`Edit ${row.name}`}
                icon={<Edit2 size={16} />}
                size="sm"
                variant="outline"
                onClick={() => {
                  setSelectedCategory(row);
                  categoryModal.onOpen();
                }}
              />
              <ActionIconButton
                aria-label={`Delete ${row.name}`}
                tooltip={
                  (row.ingredientCount ?? 0) > 0
                    ? "Cannot delete category with ingredients"
                    : `Delete ${row.name}`
                }
                icon={<Trash2 size={16} />}
                size="sm"
                variant="outline"
                colorScheme="red"
                isDisabled={Boolean((row.ingredientCount ?? 0) > 0)}
                onClick={() => {
                  setSelectedCategory(row);
                  deleteCategoryDialog.onOpen();
                }}
              />
            </HStack>
          )
        }
      ] as Array<{ key: string; header: string; render?: (row: IngredientCategory) => ReactNode }>,
    [categoryModal, deleteCategoryDialog]
  );

  const ingredientColumns = useMemo(
    () =>
      [
        { key: "name", header: "Name" },
        { key: "categoryName", header: "Category" },
        {
          key: "totalStock",
          header: "Total Stock",
          render: (row: IngredientListItem) => formatQuantityWithUnit(row.totalStock, row.unit)
        },
        {
          key: "minStock",
          header: "Min Stock",
          render: (row: IngredientListItem) => formatQuantityWithUnit(row.minStock, row.unit)
        },
        {
          key: "status",
          header: "Stock Status",
          render: (row: IngredientListItem) =>
            row.isActive ? (
              statusBadge(row.status)
            ) : (
              <Box
                px={3}
                py={1}
                borderRadius="full"
                fontSize="xs"
                fontWeight={700}
                bg="gray.100"
                color="gray.700"
                w="fit-content"
              >
                Inactive
              </Box>
            )
        },
        {
          key: "availability",
          header: "Availability",
          render: (row: IngredientListItem) => (
            <HStack spacing={3}>
              <Switch
                colorScheme="brand"
                isChecked={row.isActive}
                isDisabled={Boolean(rowActionLoading[`active-${row.id}`])}
                onChange={(event) => void handleToggleIngredientStatus(row, event.target.checked)}
              />
              <Text fontSize="sm" fontWeight={600} color={row.isActive ? "green.700" : "gray.600"}>
                {row.isActive ? "Enabled" : "Disabled"}
              </Text>
            </HStack>
          )
        },
        {
          key: "actions",
          header: "Actions",
          render: (row: IngredientListItem) => (
            <HStack spacing={2} flexWrap="nowrap" whiteSpace="nowrap" minW="max-content">
              <ActionIconButton
                aria-label={`Edit ${row.name}`}
                icon={<Edit2 size={16} />}
                size="sm"
                variant="outline"
                onClick={() => {
                  setSelectedIngredient(row);
                  ingredientModal.onOpen();
                }}
              />
              <ActionIconButton
                aria-label={`View stock ${row.name}`}
                icon={<Eye size={16} />}
                size="sm"
                variant="outline"
                onClick={() => void openStockDetails(row)}
              />
              <ActionIconButton
                aria-label={`Delete ${row.name}`}
                icon={<Trash2 size={16} />}
                size="sm"
                variant="outline"
                colorScheme="red"
                onClick={() => {
                  setSelectedIngredient(row);
                  deleteIngredientDialog.onOpen();
                }}
              />
            </HStack>
          )
        }
      ] as Array<{ key: string; header: string; render?: (row: IngredientListItem) => ReactNode }>,
    [deleteIngredientDialog, handleToggleIngredientStatus, ingredientModal, openStockDetails, rowActionLoading]
  );

  const allocationColumns = useMemo(
    () =>
      [
        {
          key: "ingredient",
          header: "Ingredient",
          render: (row: AllocationRow) => (
            <VStack align="start" spacing={0}>
              <Text fontWeight={700}>{row.ingredientName}</Text>
              <Text fontSize="sm" color="#6F5A50">
                {row.categoryName} | {row.unit.toUpperCase()}
              </Text>
            </VStack>
          )
        },
        {
          key: "totalStock",
          header: "Total Stock",
          render: (row: AllocationRow) => formatQuantityWithUnit(row.totalStock, row.unit)
        },
        {
          key: "allocated",
          header: "Allocated",
          render: (row: AllocationRow) => (
            <HStack align="end">
              <Input
                size="sm"
                type="number"
                step="0.001"
                value={allocationDrafts[row.ingredientId] ?? ""}
                onChange={(event) =>
                  setAllocationDrafts((previous) => ({
                    ...previous,
                    [row.ingredientId]: event.target.value
                  }))
                }
                bg="white"
                maxW="110px"
              />
              <AppButton
                size="sm"
                onClick={() => void handleSaveAllocation(row)}
                isLoading={Boolean(rowActionLoading[`alloc-${row.ingredientId}`])}
              >
                Save
              </AppButton>
            </HStack>
          )
        },
        {
          key: "used",
          header: "Used",
          render: (row: AllocationRow) => (
            <HStack align="end">
              <Input
                size="sm"
                type="number"
                step="0.001"
                value={usageDrafts[row.ingredientId] ?? ""}
                onChange={(event) =>
                  setUsageDrafts((previous) => ({
                    ...previous,
                    [row.ingredientId]: event.target.value
                  }))
                }
                bg="white"
                maxW="110px"
                isDisabled={!row.allocationId}
              />
              <AppButton
                size="sm"
                variant="outline"
                onClick={() => void handleSaveUsage(row)}
                isLoading={Boolean(rowActionLoading[`use-${row.ingredientId}`])}
                isDisabled={!row.allocationId}
              >
                Update
              </AppButton>
            </HStack>
          )
        },
        {
          key: "remainingQuantity",
          header: "Remaining",
          render: (row: AllocationRow) => formatQuantityWithUnit(row.remainingQuantity, row.unit)
        },
        {
          key: "status",
          header: "Status",
          render: (row: AllocationRow) => statusBadge(row.status)
        }
      ] as Array<{ key: string; header: string; render?: (row: AllocationRow) => ReactNode }>,
    [allocationDrafts, handleSaveAllocation, handleSaveUsage, rowActionLoading, usageDrafts]
  );

  const statsTableColumns = useMemo(
    () =>
      [
        {
          key: "ingredientName",
          header: "Ingredient",
          render: (row: AllocationRow) => (
            <VStack align="start" spacing={0}>
              <Text fontWeight={700}>{row.ingredientName}</Text>
              <Text fontSize="xs" color="#7A6258">
                {row.categoryName} | {row.unit.toUpperCase()}
              </Text>
            </VStack>
          )
        },
        {
          key: "totalStock",
          header: "Current Stock",
          render: (row: AllocationRow) => formatQuantityWithUnit(row.totalStock, row.unit)
        },
        {
          key: "allocatedQuantity",
          header: "Allocated Today",
          render: (row: AllocationRow) => formatQuantityWithUnit(row.allocatedQuantity, row.unit)
        },
        {
          key: "usedQuantity",
          header: "Used Today",
          render: (row: AllocationRow) => formatQuantityWithUnit(row.usedQuantity, row.unit)
        },
        {
          key: "remainingQuantity",
          header: "Remaining Today",
          render: (row: AllocationRow) => formatQuantityWithUnit(row.remainingQuantity, row.unit)
        },
        {
          key: "allocationHealth",
          header: "Allocation Health",
          render: (row: AllocationRow) => {
            const ratio = row.allocatedQuantity > 0 ? row.usedQuantity / row.allocatedQuantity : 0;
            const label =
              row.allocatedQuantity <= 0
                ? "Not Allocated"
                : ratio >= 1
                  ? "Exceeded"
                  : ratio >= 0.8
                    ? "Near Limit"
                    : "Safe";
            const bg =
              label === "Exceeded"
                ? "red.100"
                : label === "Near Limit"
                  ? "orange.100"
                  : label === "Not Allocated"
                    ? "gray.100"
                    : "green.100";
            const color =
              label === "Exceeded"
                ? "red.700"
                : label === "Near Limit"
                  ? "orange.700"
                  : label === "Not Allocated"
                    ? "gray.700"
                    : "green.700";
            return (
              <Box px={3} py={1} borderRadius="full" bg={bg} color={color} fontWeight={700} fontSize="xs" w="fit-content">
                {label}
              </Box>
            );
          }
        }
      ] as Array<{ key: string; header: string; render?: (row: AllocationRow) => ReactNode }>,
    []
  );

  const formatRupee = (value: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0
    }).format(value);

  const staffUsageColumns = useMemo(
    () =>
      [
        { key: "staffName", header: "Staff" },
        { key: "ingredientCount", header: "Ingredients Used" },
        {
          key: "consumedQuantity",
          header: "Total Consumption",
          render: (row: { consumedQuantity: number }) => `${formatQuantity(row.consumedQuantity, 2)} (mixed units)`
        }
      ] as Array<{
        key: string;
        header: string;
        render?: (row: { consumedQuantity: number; staffName: string; ingredientCount: number }) => ReactNode;
      }>,
    []
  );

  const statusChartData = allocationStats?.charts.statusBreakdown ?? [];
  const topUsedChartData = allocationStats?.charts.topUsedIngredients ?? [];

  return (
    <VStack spacing={6} align="stretch">
      <PageHeader
        title="Ingredient & Stock Management"
        subtitle="Manage categories, ingredients, stock operations and daily allocations with low-stock visibility."
      />

      <Tabs variant="soft-rounded" colorScheme="brand" isLazy>
        <TabList>
          <Tab>Stats</Tab>
          <Tab>Categories</Tab>
          <Tab>Ingredients</Tab>
          <Tab>Stock & Allocation</Tab>
        </TabList>
        <TabPanels>
          <TabPanel px={0}>
            <AppCard
              title="Allocation Stats"
              subtitle="Filter and analyze daily ingredient allocation, usage, remaining and staff consumption."
            >
              <VStack spacing={4} align="stretch">
                <SimpleGrid columns={{ base: 1, md: 2, xl: 4 }} spacing={4}>
                  <AppInput
                    label="Date"
                    type="date"
                    value={allocationDate}
                    onChange={(event) => setAllocationDate((event.target as HTMLInputElement).value)}
                  />
                  <AppInput
                    label="Search Ingredient"
                    placeholder="Search ingredient for stats"
                    value={statsSearch}
                    onChange={(event) => setStatsSearch((event.target as HTMLInputElement).value)}
                  />
                  <FormControl>
                    <FormLabel>Category</FormLabel>
                    <Select
                      value={statsCategoryFilter}
                      onChange={(event) => setStatsCategoryFilter(event.target.value)}
                    >
                      <option value="">All Categories</option>
                      {categoryOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl>
                    <FormLabel>Records per page</FormLabel>
                    <Select
                      value={String(statsLimit)}
                      onChange={(event) => {
                        const nextLimit = Number(event.target.value) || 8;
                        setStatsLimit(nextLimit);
                        setStatsPage(1);
                      }}
                    >
                      <option value="5">5</option>
                      <option value="8">8</option>
                      <option value="12">12</option>
                      <option value="20">20</option>
                    </Select>
                  </FormControl>
                </SimpleGrid>

                {allocationStatsLoading || !allocationStats ? (
                  <SkeletonTable />
                ) : (
                  <VStack align="stretch" spacing={4}>
                    <SimpleGrid columns={{ base: 1, sm: 2, xl: 4 }} spacing={3}>
                      <StatsMetricCard
                        label="Ingredients"
                        value={String(allocationStats.totals.totalIngredients)}
                        helper="Total in current filter"
                      />
                      <StatsMetricCard
                        label="Allocated"
                        value={String(allocationStats.totals.allocatedIngredients)}
                        helper={`${allocationStats.totals.missingAllocationIngredients} without allocation`}
                      />
                      <StatsMetricCard
                        label="Low Stock"
                        value={String(allocationStats.totals.lowStockIngredients)}
                        helper="Needs replenishment"
                      />
                      <StatsMetricCard
                        label="Valuation"
                        value={formatRupee(allocationStats.quantities.totalValuation)}
                        helper="Based on current stock × per unit price"
                      />
                    </SimpleGrid>

                    <SimpleGrid columns={{ base: 1, xl: 2 }} spacing={4}>
                      <Box
                        p={4}
                        borderRadius="16px"
                        border="1px solid"
                        borderColor="rgba(132, 79, 52, 0.2)"
                        bg="linear-gradient(180deg, #FFFFFF 0%, #FFF9EE 100%)"
                      >
                        <Text fontWeight={800} color="#2A1A14" mb={2}>
                          Stock Health Distribution
                        </Text>
                        <Box h="220px">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={statusChartData}
                                dataKey="value"
                                nameKey="label"
                                innerRadius={58}
                                outerRadius={88}
                                paddingAngle={2}
                              >
                                {statusChartData.map((_, index) => (
                                  <Cell key={`stats-status-${index}`} fill={chartColors[index % chartColors.length]} />
                                ))}
                              </Pie>
                              <Tooltip />
                            </PieChart>
                          </ResponsiveContainer>
                        </Box>
                      </Box>

                      <Box
                        p={4}
                        borderRadius="16px"
                        border="1px solid"
                        borderColor="rgba(132, 79, 52, 0.2)"
                        bg="linear-gradient(180deg, #FFFFFF 0%, #FFF9EE 100%)"
                      >
                        <Text fontWeight={800} color="#2A1A14" mb={2}>
                          Top Used Ingredients
                        </Text>
                        <Box h="220px">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={topUsedChartData}>
                              <XAxis dataKey="ingredientName" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} />
                              <Tooltip />
                              <Bar dataKey="usedQuantity" fill="#B91C1C" radius={[8, 8, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </Box>
                      </Box>
                    </SimpleGrid>
                  </VStack>
                )}

                <Box
                  p={4}
                  borderRadius="16px"
                  border="1px solid"
                  borderColor="rgba(132, 79, 52, 0.2)"
                  bg="white"
                >
                  <Text fontWeight={800} color="#2A1A14" mb={3}>
                    Today's Allocation Summary
                  </Text>
                  {statsLoading ? (
                    <SkeletonTable />
                  ) : (
                    <DataTable
                      columns={statsTableColumns}
                      rows={statsRows.map((row) => ({ ...row, id: row.ingredientId }))}
                      emptyState={
                        <EmptyState
                          title="No allocation stats found"
                          description="Try a different date or category filter."
                        />
                      }
                    />
                  )}
                  <PaginationControls
                    page={statsPagination.page}
                    totalPages={statsPagination.totalPages}
                    total={statsPagination.total}
                    showing={statsRows.length}
                    onPageChange={setStatsPage}
                  />
                </Box>

                <Box
                  p={4}
                  borderRadius="16px"
                  border="1px solid"
                  borderColor="rgba(132, 79, 52, 0.2)"
                  bg="white"
                >
                  <Text fontWeight={800} color="#2A1A14" mb={3}>
                    Staff Usage (Selected Date)
                  </Text>
                  {allocationStatsLoading || !allocationStats ? (
                    <SkeletonTable />
                  ) : (
                    <DataTable
                      columns={staffUsageColumns}
                      rows={allocationStats.insights.staffUsageSummary.map((row) => ({
                        ...row,
                        id: row.staffId
                      }))}
                      emptyState={
                        <EmptyState
                          title="No staff usage on this date"
                          description="Once staff creates paid invoices, consumption will appear here."
                        />
                      }
                    />
                  )}
                </Box>
              </VStack>
            </AppCard>
          </TabPanel>

          <TabPanel px={0}>
            <AppCard>
              <VStack spacing={4} align="stretch">
                <SimpleGrid columns={{ base: 1, md: 4 }} spacing={4}>
                  <AppInput
                    label="Search"
                    placeholder="Search categories"
                    value={categorySearch}
                    onChange={(event) => setCategorySearch((event.target as HTMLInputElement).value)}
                  />
                  <FormControl>
                    <FormLabel>Records per page</FormLabel>
                    <Select
                      value={String(categoryLimit)}
                      onChange={(event) => {
                        const nextLimit = Number(event.target.value) || 5;
                        setCategoryLimit(nextLimit);
                        setCategoryPage(1);
                      }}
                    >
                      <option value="5">5</option>
                      <option value="10">10</option>
                      <option value="20">20</option>
                    </Select>
                  </FormControl>
                  <Box />
                  <Box alignSelf="end">
                    <AppButton
                      leftIcon={<Plus size={16} />}
                      onClick={() => {
                        setSelectedCategory(null);
                        categoryModal.onOpen();
                      }}
                    >
                      Add Category
                    </AppButton>
                  </Box>
                </SimpleGrid>

                {categoryLoading ? (
                  <SkeletonTable />
                ) : (
                  <DataTable
                    columns={categoryColumns}
                    rows={categoryRows}
                    emptyState={
                      <EmptyState
                        title="No categories found"
                        description="Create your first ingredient category to organize inventory."
                      />
                    }
                  />
                )}

                <PaginationControls
                  page={categoryPagination.page}
                  totalPages={categoryPagination.totalPages}
                  total={categoryPagination.total}
                  showing={categoryRows.length}
                  onPageChange={setCategoryPage}
                />
              </VStack>
            </AppCard>
          </TabPanel>

          <TabPanel px={0}>
            <AppCard>
              <VStack spacing={4} align="stretch">
                <SimpleGrid columns={{ base: 1, md: 4 }} spacing={4}>
                  <AppInput
                    label="Search Ingredient"
                    placeholder="Search by ingredient name"
                    value={ingredientSearch}
                    onChange={(event) => setIngredientSearch((event.target as HTMLInputElement).value)}
                  />
                  <FormControl>
                    <FormLabel>Category</FormLabel>
                    <Select
                      value={ingredientCategoryFilter}
                      onChange={(event) => setIngredientCategoryFilter(event.target.value)}
                    >
                      <option value="">All Categories</option>
                      {categoryOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl>
                    <FormLabel>Records per page</FormLabel>
                    <Select
                      value={String(ingredientLimit)}
                      onChange={(event) => {
                        const nextLimit = Number(event.target.value) || 5;
                        setIngredientLimit(nextLimit);
                        setIngredientPage(1);
                      }}
                    >
                      <option value="5">5</option>
                      <option value="10">10</option>
                      <option value="20">20</option>
                    </Select>
                  </FormControl>
                  <Box alignSelf="end">
                    <AppButton
                      leftIcon={<Plus size={16} />}
                      isDisabled={!allCategories.length}
                      onClick={() => {
                        setSelectedIngredient(null);
                        ingredientModal.onOpen();
                      }}
                    >
                      Add Ingredient
                    </AppButton>
                  </Box>
                </SimpleGrid>

                {ingredientLoading ? (
                  <SkeletonTable />
                ) : (
                  <DataTable
                    columns={ingredientColumns}
                    rows={ingredientRows}
                    emptyState={
                      <EmptyState
                        title="No ingredients found"
                        description="Create ingredients and manage stock to start tracking inventory."
                      />
                    }
                  />
                )}

                <PaginationControls
                  page={ingredientPagination.page}
                  totalPages={ingredientPagination.totalPages}
                  total={ingredientPagination.total}
                  showing={ingredientRows.length}
                  onPageChange={setIngredientPage}
                />
              </VStack>
            </AppCard>
          </TabPanel>

          <TabPanel px={0}>
            <AppCard>
              <VStack spacing={4} align="stretch">
                <SimpleGrid columns={{ base: 1, md: 4 }} spacing={4}>
                  <AppInput
                    label="Date"
                    type="date"
                    value={allocationDate}
                    onChange={(event) => setAllocationDate((event.target as HTMLInputElement).value)}
                  />
                  <AppInput
                    label="Search Ingredient"
                    placeholder="Search by ingredient"
                    value={allocationSearch}
                    onChange={(event) => setAllocationSearch((event.target as HTMLInputElement).value)}
                  />
                  <FormControl>
                    <FormLabel>Category</FormLabel>
                    <Select
                      value={allocationCategoryFilter}
                      onChange={(event) => setAllocationCategoryFilter(event.target.value)}
                    >
                      <option value="">All Categories</option>
                      {categoryOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl>
                    <FormLabel>Records per page</FormLabel>
                    <Select
                      value={String(allocationLimit)}
                      onChange={(event) => {
                        const nextLimit = Number(event.target.value) || 5;
                        setAllocationLimit(nextLimit);
                        setAllocationPage(1);
                      }}
                    >
                      <option value="5">5</option>
                      <option value="10">10</option>
                      <option value="20">20</option>
                    </Select>
                  </FormControl>
                </SimpleGrid>

                <HStack justify="space-between" flexWrap="wrap" gap={3}>
                  <Text color="#6F5A50" fontSize="sm">
                    Daily allocation is mandatory for staff POS billing. Use quick actions to allocate in one click.
                    {posBillingControl
                      ? ` POS billing is currently ${posBillingControl.isBillingEnabled ? "enabled" : "paused"}.`
                      : ""}
                  </Text>
                  <HStack>
                    <AppButton
                      variant={posBillingControl?.isBillingEnabled ? "outline" : "solid"}
                      onClick={posControlDialog.onOpen}
                      isLoading={posControlLoading}
                    >
                      {posBillingControl?.isBillingEnabled ? "Pause POS Billing" : "Resume POS Billing"}
                    </AppButton>
                    <AppButton
                      variant="outline"
                      onClick={continueYesterdayDialog.onOpen}
                      isLoading={bulkActionLoading}
                    >
                      Continue Yesterday Allocation
                    </AppButton>
                    <AppButton onClick={assignAllDialog.onOpen} isLoading={bulkActionLoading}>
                      Allocate All Available Stock
                    </AppButton>
                  </HStack>
                </HStack>

                {allocationLoading ? (
                  <SkeletonTable />
                ) : (
                  <DataTable
                    columns={allocationColumns}
                    rows={allocationRows.map((row) => ({ ...row, id: row.ingredientId }))}
                    emptyState={
                      <EmptyState
                        title="No allocation data found"
                        description="Create ingredients first, then allocate daily stock usage."
                      />
                    }
                  />
                )}

                <PaginationControls
                  page={allocationPagination.page}
                  totalPages={allocationPagination.totalPages}
                  total={allocationPagination.total}
                  showing={allocationRows.length}
                  onPageChange={setAllocationPage}
                />
              </VStack>
            </AppCard>
          </TabPanel>
        </TabPanels>
      </Tabs>

      <CategoryFormModal
        isOpen={categoryModal.isOpen}
        onClose={() => {
          categoryModal.onClose();
          setSelectedCategory(null);
        }}
        onSubmit={handleCategorySubmit}
        loading={categoryMutationLoading}
        initialData={selectedCategory}
      />

      <IngredientFormModal
        isOpen={ingredientModal.isOpen}
        onClose={() => {
          ingredientModal.onClose();
          setSelectedIngredient(null);
        }}
        onSubmit={handleIngredientSubmit}
        loading={ingredientMutationLoading}
        categories={allCategories}
        initialData={selectedIngredient}
      />

      <StockDetailsModal
        isOpen={stockDetailsModal.isOpen}
        onClose={stockDetailsModal.onClose}
        loading={stockDetailsLoading}
        stock={stockDetails}
        logs={stockLogs}
      />

      <ConfirmDialog
        isOpen={deleteCategoryDialog.isOpen}
        onClose={deleteCategoryDialog.onClose}
        title="Delete Category Permanently"
        description={
          (selectedCategory?.ingredientCount ?? 0) > 0
            ? `${selectedCategory?.name ?? "This category"} has ${selectedCategory?.ingredientCount ?? 0} ingredient(s). Move or delete ingredients first.`
            : `Are you sure you want to permanently delete ${selectedCategory?.name ?? "this category"}?`
        }
        onConfirm={() => void handleDeleteCategory()}
        isLoading={categoryMutationLoading}
      />

      <ConfirmDialog
        isOpen={deleteIngredientDialog.isOpen}
        onClose={deleteIngredientDialog.onClose}
        title="Delete Ingredient Permanently"
        description={`Are you sure you want to permanently delete ${selectedIngredient?.name ?? "this ingredient"}?`}
        onConfirm={() => void handleDeleteIngredient()}
        isLoading={ingredientMutationLoading}
      />

      <ConfirmDialog
        isOpen={assignAllDialog.isOpen}
        onClose={assignAllDialog.onClose}
        title="Allocate All Available Stock"
        description={`This will allocate all current stock to ${allocationDate}. This action moves stock from central balance to today's allocation. Continue?`}
        onConfirm={() => void handleAssignAllStock()}
        isLoading={bulkActionLoading}
      />

      <ConfirmDialog
        isOpen={continueYesterdayDialog.isOpen}
        onClose={continueYesterdayDialog.onClose}
        title="Continue Yesterday Allocation"
        description={`This will carry-forward remaining quantity from ${getPreviousDateString(allocationDate)} into ${allocationDate} without re-deducting central stock. Continue?`}
        onConfirm={() => void handleContinueYesterday()}
        isLoading={bulkActionLoading}
      />

      <ConfirmDialog
        isOpen={posControlDialog.isOpen}
        onClose={posControlDialog.onClose}
        title={posBillingControl?.isBillingEnabled ? "Pause POS Billing" : "Resume POS Billing"}
        description={
          posBillingControl?.isBillingEnabled
            ? "This will immediately block staff from taking new orders in POS. Existing orders can still be reviewed."
            : "This will allow staff to take new POS orders again."
        }
        onConfirm={() => void handleTogglePosBillingControl()}
        isLoading={posControlLoading}
      />
    </VStack>
  );
};
