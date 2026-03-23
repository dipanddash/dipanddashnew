import {
  Box,
  Checkbox,
  FormControl,
  FormLabel,
  HStack,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  SimpleGrid,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  Textarea,
  VStack,
  useDisclosure
} from "@chakra-ui/react";
import { Edit2, Eye, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { PageHeader } from "@/components/common/PageHeader";
import { SkeletonTable } from "@/components/feedback/SkeletonTable";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { AppButton } from "@/components/ui/AppButton";
import { AppCard } from "@/components/ui/AppCard";
import { AppInput } from "@/components/ui/AppInput";
import {
  AppSearchableSelect,
  type AppSearchableSelectOption
} from "@/components/ui/AppSearchableSelect";
import { DataTable } from "@/components/ui/DataTable";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useAppToast } from "@/hooks/useAppToast";
import { useModalCloseGuard } from "@/hooks/useModalCloseGuard";
import { procurementService } from "@/services/procurement.service";
import type {
  CreatePurchaseLineInput,
  ProductListItem,
  ProductListResponse,
  ProcurementMetaResponse,
  ProcurementStatsResponse,
  ProductUnit,
  PurchaseLineType,
  PurchaseOrderDetail,
  PurchaseOrderSummary,
  SupplierListItem
} from "@/types/procurement";
import { extractErrorMessage } from "@/utils/api-error";

const defaultPagination = {
  page: 1,
  limit: 5,
  total: 0,
  totalPages: 1
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "2-digit" });
};

const getTodayDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const createDraftLineId = () => Math.random().toString(36).slice(2, 10);

type DraftPurchaseLine = {
  id: string;
  lineType: PurchaseLineType;
  ingredientCategoryId: string;
  ingredientId: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  updateUnitPrice: boolean;
  note: string;
};

const createEmptyLine = (): DraftPurchaseLine => ({
  id: createDraftLineId(),
  lineType: "ingredient",
  ingredientCategoryId: "",
  ingredientId: "",
  productId: "",
  quantity: "1",
  unitPrice: "0",
  updateUnitPrice: false,
  note: ""
});

type PurchaseOrderModalProps = {
  isOpen: boolean;
  onClose: () => void;
  loading: boolean;
  meta: ProcurementMetaResponse | null;
  onLoadMetaForDate: (date: string) => Promise<void>;
  onSubmit: (payload: { supplierId: string; purchaseDate: string; note?: string; lines: CreatePurchaseLineInput[] }) => Promise<void>;
};

const PurchaseOrderModal = ({
  isOpen,
  onClose,
  loading,
  meta,
  onLoadMetaForDate,
  onSubmit
}: PurchaseOrderModalProps) => {
  const { isCloseConfirmOpen, requestClose, cancelCloseRequest, confirmClose } = useModalCloseGuard(onClose);
  const [supplierId, setSupplierId] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(getTodayDate());
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftPurchaseLine[]>([createEmptyLine()]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setSupplierId(meta?.suppliers[0]?.id ?? "");
    setPurchaseDate(meta?.date ?? getTodayDate());
    setNote("");
    setLines([createEmptyLine()]);
  }, [isOpen, meta?.date, meta?.suppliers]);

  const supplierOptions: AppSearchableSelectOption[] = useMemo(
    () =>
      (meta?.suppliers ?? []).map((supplier) => ({
        value: supplier.id,
        label: supplier.name,
        description: `${supplier.phone}${supplier.address ? ` | ${supplier.address}` : ""}`,
        searchText: `${supplier.name} ${supplier.phone} ${supplier.address ?? ""}`
      })),
    [meta?.suppliers]
  );

  const categoryOptions: AppSearchableSelectOption[] = useMemo(
    () =>
      (meta?.ingredientCategories ?? []).map((category) => ({
        value: category.id,
        label: category.name,
        description: category.description ?? undefined
      })),
    [meta?.ingredientCategories]
  );

  const productOptions: AppSearchableSelectOption[] = useMemo(
    () =>
      (meta?.products ?? []).map((product) => ({
        value: product.id,
        label: product.name,
        description: `${product.category} | Stock ${product.currentStock} ${product.unit}`,
        searchText: `${product.name} ${product.category} ${product.sku ?? ""} ${product.packSize ?? ""}`
      })),
    [meta?.products]
  );

  const getIngredientOptions = useCallback(
    (categoryId: string): AppSearchableSelectOption[] =>
      (meta?.ingredients ?? [])
        .filter((ingredient) => !categoryId || ingredient.categoryId === categoryId)
        .map((ingredient) => ({
          value: ingredient.id,
          label: ingredient.name,
          description: `${ingredient.categoryName} | Stock ${ingredient.currentStock} ${ingredient.unit}`,
          searchText: `${ingredient.name} ${ingredient.categoryName} ${ingredient.unit}`
        })),
    [meta?.ingredients]
  );

  const totalAmount = useMemo(
    () =>
      lines.reduce((acc, line) => {
        const qty = Number(line.quantity);
        const price = Number(line.unitPrice);
        if (!Number.isFinite(qty) || !Number.isFinite(price)) {
          return acc;
        }
        return acc + qty * price;
      }, 0),
    [lines]
  );

  const updateLine = (id: string, next: Partial<DraftPurchaseLine>) => {
    setLines((previous) => previous.map((line) => (line.id === id ? { ...line, ...next } : line)));
  };

  const handleDateChange = async (nextDate: string) => {
    setPurchaseDate(nextDate);
    await onLoadMetaForDate(nextDate);
  };

  const addLine = () => {
    setLines((previous) => [...previous, createEmptyLine()]);
  };

  const removeLine = (id: string) => {
    setLines((previous) => (previous.length <= 1 ? previous : previous.filter((line) => line.id !== id)));
  };

  const handleIngredientPick = (line: DraftPurchaseLine, ingredientId: string) => {
    const ingredient = (meta?.ingredients ?? []).find((entry) => entry.id === ingredientId);
    updateLine(line.id, {
      ingredientId,
      unitPrice: ingredient ? String(ingredient.perUnitPrice) : line.unitPrice
    });
  };

  const handleProductPick = (line: DraftPurchaseLine, productId: string) => {
    const product = (meta?.products ?? []).find((entry) => entry.id === productId);
    updateLine(line.id, {
      productId,
      unitPrice: product ? String(product.purchaseUnitPrice) : line.unitPrice
    });
  };

  const handleSave = async () => {
    const payloadLines = lines
      .map((line) => {
        const quantity = Number(line.quantity);
        const unitPrice = Number(line.unitPrice);
        if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice) || quantity <= 0 || unitPrice < 0) {
          return null;
        }
        return {
          lineType: line.lineType,
          ingredientId: line.lineType === "ingredient" ? line.ingredientId || undefined : undefined,
          productId: line.lineType === "product" ? line.productId || undefined : undefined,
          quantity,
          unitPrice,
          updateUnitPrice: line.updateUnitPrice,
          note: line.note.trim() || undefined
        } as CreatePurchaseLineInput;
      })
      .filter((line): line is CreatePurchaseLineInput => Boolean(line));

    if (!supplierId || payloadLines.length !== lines.length) {
      return;
    }

    await onSubmit({
      supplierId,
      purchaseDate,
      note: note.trim() || undefined,
      lines: payloadLines
    });
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={requestClose} size="6xl" closeOnOverlayClick={false} closeOnEsc={false}>
        <ModalOverlay />
        <ModalContent borderRadius="20px">
          <ModalHeader>Create Purchase Order</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={4} align="stretch">
              <SimpleGrid columns={{ base: 1, md: 3 }} spacing={3}>
                <AppSearchableSelect
                  label="Supplier"
                  value={supplierId}
                  options={supplierOptions}
                  onValueChange={setSupplierId}
                  placeholder="Select supplier"
                  searchPlaceholder="Search supplier"
                />
                <AppInput
                  label="Purchase Date"
                  type="date"
                  value={purchaseDate}
                  onChange={(event) => void handleDateChange((event.target as HTMLInputElement).value)}
                />
                <Box border="1px solid" borderColor="rgba(133, 78, 48, 0.2)" borderRadius="12px" px={4} py={3} bg="white">
                  <Text color="#6F594F" fontWeight={600} fontSize="sm">
                    Draft Total
                  </Text>
                  <Text fontSize="2xl" fontWeight={900}>
                    {formatCurrency(totalAmount)}
                  </Text>
                </Box>
              </SimpleGrid>

              {lines.map((line, index) => {
                const selectedIngredient = (meta?.ingredients ?? []).find((item) => item.id === line.ingredientId);
                const selectedProduct = (meta?.products ?? []).find((item) => item.id === line.productId);

                return (
                  <AppCard key={line.id} p={4}>
                    <SimpleGrid columns={{ base: 1, lg: 6 }} spacing={3}>
                      <AppSearchableSelect
                        label={`Line ${index + 1} Type`}
                        value={line.lineType}
                        options={[{ value: "ingredient", label: "Ingredient" }, { value: "product", label: "Product" }]}
                        onValueChange={(value) =>
                          updateLine(line.id, {
                            lineType: value as PurchaseLineType,
                            ingredientId: "",
                            productId: "",
                            unitPrice: "0"
                          })
                        }
                        isClearable={false}
                      />
                      {line.lineType === "ingredient" ? (
                        <>
                          <AppSearchableSelect
                            label="Ingredient Category"
                            value={line.ingredientCategoryId}
                            options={categoryOptions}
                            onValueChange={(value) => updateLine(line.id, { ingredientCategoryId: value, ingredientId: "" })}
                            placeholder="Select category"
                            searchPlaceholder="Search category"
                          />
                          <AppSearchableSelect
                            label="Ingredient"
                            value={line.ingredientId}
                            options={getIngredientOptions(line.ingredientCategoryId)}
                            onValueChange={(value) => handleIngredientPick(line, value)}
                            placeholder="Select ingredient"
                            searchPlaceholder="Search ingredient"
                          />
                        </>
                      ) : (
                        <AppSearchableSelect
                          label="Product"
                          value={line.productId}
                          options={productOptions}
                          onValueChange={(value) => handleProductPick(line, value)}
                          placeholder="Select product"
                          searchPlaceholder="Search product"
                        />
                      )}
                      <AppInput
                        label="Quantity"
                        type="number"
                        min={0}
                        step="0.001"
                        value={line.quantity}
                        onChange={(event) => updateLine(line.id, { quantity: (event.target as HTMLInputElement).value })}
                      />
                      <AppInput
                        label="Unit Price"
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(event) => updateLine(line.id, { unitPrice: (event.target as HTMLInputElement).value })}
                      />
                      <FormControl>
                        <FormLabel>Actions</FormLabel>
                        <HStack>
                          <Checkbox
                            isChecked={line.updateUnitPrice}
                            onChange={(event) => updateLine(line.id, { updateUnitPrice: event.target.checked })}
                          >
                            Update price
                          </Checkbox>
                          <ActionIconButton
                            aria-label="Remove line"
                            tooltip="Remove line"
                            icon={<Trash2 size={16} />}
                            variant="outline"
                            colorScheme="accentRed"
                            onClick={() => removeLine(line.id)}
                            isDisabled={lines.length <= 1}
                          />
                        </HStack>
                      </FormControl>
                    </SimpleGrid>
                    <Box mt={2}>
                      {line.lineType === "ingredient" && selectedIngredient ? (
                        <Text fontSize="sm" color="#725A50">
                          Stock: {selectedIngredient.currentStock} {selectedIngredient.unit} | Allocated:{" "}
                          {selectedIngredient.allocatedToday} | Used: {selectedIngredient.usedToday} | Pending:{" "}
                          {selectedIngredient.pendingToday}
                        </Text>
                      ) : null}
                      {line.lineType === "product" && selectedProduct ? (
                        <Text fontSize="sm" color="#725A50">
                          Stock: {selectedProduct.currentStock} {selectedProduct.unit} | Min: {selectedProduct.minStock}{" "}
                          {selectedProduct.unit}
                        </Text>
                      ) : null}
                    </Box>
                  </AppCard>
                );
              })}

              <HStack justify="space-between">
                <AppButton leftIcon={<Plus size={16} />} variant="outline" onClick={addLine}>
                  Add Line
                </AppButton>
                <Text fontWeight={800} color="#36251E">
                  Total: {formatCurrency(totalAmount)}
                </Text>
              </HStack>

              <FormControl>
                <FormLabel>Note (optional)</FormLabel>
                <Textarea
                  value={note}
                  onChange={(event) => setNote((event.target as HTMLTextAreaElement).value)}
                  placeholder="Add purchase note"
                  borderColor="rgba(193, 14, 14, 0.18)"
                  focusBorderColor="brand.400"
                  bg="white"
                />
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter gap={3}>
            <AppButton variant="outline" onClick={requestClose}>
              Cancel
            </AppButton>
            <AppButton
              onClick={() => void handleSave()}
              isLoading={loading}
              isDisabled={!supplierId || lines.some((line) => !line.quantity || !line.unitPrice)}
            >
              Create Purchase Order
            </AppButton>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <ConfirmDialog
        isOpen={isCloseConfirmOpen}
        title="Close this popup?"
        description="Are you sure you want to close? Unsaved purchase lines will be removed."
        onClose={cancelCloseRequest}
        onConfirm={confirmClose}
      />
    </>
  );
};

type ProductFormModalProps = {
  isOpen: boolean;
  onClose: () => void;
  loading: boolean;
  initialData: ProductListItem | null;
  suppliers: SupplierListItem[];
  units: string[];
  onSubmit: (payload: {
    name: string;
    category: string;
    sku?: string;
    packSize?: string;
    unit: ProductUnit;
    currentStock: number;
    minStock: number;
    purchaseUnitPrice: number;
    defaultSupplierId?: string | null;
    isActive: boolean;
  }) => Promise<void>;
};

const ProductFormModal = ({ isOpen, onClose, loading, initialData, suppliers, units, onSubmit }: ProductFormModalProps) => {
  const { isCloseConfirmOpen, requestClose, cancelCloseRequest, confirmClose } = useModalCloseGuard(onClose);
  const [form, setForm] = useState({
    name: "",
    category: "",
    sku: "",
    packSize: "",
    unit: (units[0] ?? "pcs") as ProductUnit,
    currentStock: "0",
    minStock: "0",
    purchaseUnitPrice: "0",
    defaultSupplierId: "",
    isActive: true
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setForm({
      name: initialData?.name ?? "",
      category: initialData?.category ?? "",
      sku: initialData?.sku ?? "",
      packSize: initialData?.packSize ?? "",
      unit: (initialData?.unit ?? units[0] ?? "pcs") as ProductUnit,
      currentStock: String(initialData?.currentStock ?? 0),
      minStock: String(initialData?.minStock ?? 0),
      purchaseUnitPrice: String(initialData?.purchaseUnitPrice ?? 0),
      defaultSupplierId: initialData?.defaultSupplierId ?? "",
      isActive: initialData?.isActive ?? true
    });
  }, [initialData, isOpen, units]);

  const supplierOptions: AppSearchableSelectOption[] = useMemo(
    () =>
      suppliers.map((supplier) => ({
        value: supplier.id,
        label: supplier.name,
        description: supplier.phone,
        searchText: `${supplier.name} ${supplier.phone}`
      })),
    [suppliers]
  );

  const unitOptions: AppSearchableSelectOption[] = useMemo(
    () =>
      units.map((unit) => ({
        value: unit,
        label: unit.toUpperCase()
      })),
    [units]
  );

  const handleSave = async () => {
    await onSubmit({
      name: form.name.trim(),
      category: form.category.trim(),
      sku: form.sku.trim() || undefined,
      packSize: form.packSize.trim() || undefined,
      unit: form.unit,
      currentStock: Number(form.currentStock),
      minStock: Number(form.minStock),
      purchaseUnitPrice: Number(form.purchaseUnitPrice),
      defaultSupplierId: form.defaultSupplierId || null,
      isActive: form.isActive
    });
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={requestClose} isCentered size="xl" closeOnOverlayClick={false} closeOnEsc={false}>
        <ModalOverlay />
        <ModalContent borderRadius="18px">
          <ModalHeader>{initialData ? "Edit Product" : "Create Product"}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={4} align="stretch">
              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                <AppInput
                  label="Product Name"
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: (event.target as HTMLInputElement).value }))}
                />
                <AppInput
                  label="Category"
                  value={form.category}
                  onChange={(event) => setForm((prev) => ({ ...prev, category: (event.target as HTMLInputElement).value }))}
                />
                <AppInput
                  label="SKU (optional)"
                  value={form.sku}
                  onChange={(event) => setForm((prev) => ({ ...prev, sku: (event.target as HTMLInputElement).value }))}
                />
                <AppInput
                  label="Pack Size (optional)"
                  value={form.packSize}
                  onChange={(event) => setForm((prev) => ({ ...prev, packSize: (event.target as HTMLInputElement).value }))}
                />
                <AppSearchableSelect
                  label="Unit"
                  value={form.unit}
                  options={unitOptions}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, unit: value as ProductUnit }))}
                  isClearable={false}
                />
                <AppSearchableSelect
                  label="Default Supplier"
                  value={form.defaultSupplierId}
                  options={supplierOptions}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, defaultSupplierId: value }))}
                  placeholder="Select supplier"
                  searchPlaceholder="Search supplier"
                />
                <AppInput
                  label="Current Stock"
                  type="number"
                  min={0}
                  step="0.001"
                  value={form.currentStock}
                  onChange={(event) => setForm((prev) => ({ ...prev, currentStock: (event.target as HTMLInputElement).value }))}
                />
                <AppInput
                  label="Minimum Stock"
                  type="number"
                  min={0}
                  step="0.001"
                  value={form.minStock}
                  onChange={(event) => setForm((prev) => ({ ...prev, minStock: (event.target as HTMLInputElement).value }))}
                />
              </SimpleGrid>
              <AppInput
                label="Purchase Unit Price"
                type="number"
                min={0}
                step="0.01"
                value={form.purchaseUnitPrice}
                onChange={(event) => setForm((prev) => ({ ...prev, purchaseUnitPrice: (event.target as HTMLInputElement).value }))}
              />
              <FormControl display="flex" alignItems="center" justifyContent="space-between">
                <FormLabel mb={0}>Active Product</FormLabel>
                <Checkbox
                  isChecked={form.isActive}
                  onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))}
                >
                  Active
                </Checkbox>
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter gap={3}>
            <AppButton variant="outline" onClick={requestClose}>
              Cancel
            </AppButton>
            <AppButton
              onClick={() => void handleSave()}
              isLoading={loading}
              isDisabled={!form.name.trim() || !form.category.trim() || Number(form.purchaseUnitPrice) < 0}
            >
              {initialData ? "Save Product" : "Create Product"}
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

export const PurchasePage = () => {
  const toast = useAppToast();

  const [suppliers, setSuppliers] = useState<SupplierListItem[]>([]);
  const [meta, setMeta] = useState<ProcurementMetaResponse | null>(null);
  const [units, setUnits] = useState<string[]>([]);
  const [stats, setStats] = useState<ProcurementStatsResponse["summary"]>({
    totalSuppliers: 0,
    totalProducts: 0,
    totalPurchaseOrders: 0,
    totalPurchaseAmount: 0,
    totalProductPurchasedQuantity: 0,
    totalProductPurchasedAmount: 0
  });

  const [orderRows, setOrderRows] = useState<PurchaseOrderSummary[]>([]);
  const [orderPagination, setOrderPagination] = useState(defaultPagination);
  const [orderStats, setOrderStats] = useState({ totalOrders: 0, totalAmount: 0 });
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [orderSearch, setOrderSearch] = useState("");
  const debouncedOrderSearch = useDebouncedValue(orderSearch, 350);
  const [orderSupplierFilter, setOrderSupplierFilter] = useState("");
  const [orderPage, setOrderPage] = useState(1);
  const [orderLimit, setOrderLimit] = useState(5);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [productRows, setProductRows] = useState<ProductListItem[]>([]);
  const [productPagination, setProductPagination] = useState(defaultPagination);
  const [productStats, setProductStats] = useState<ProductListResponse["stats"]>({
    totalProducts: 0,
    activeProducts: 0,
    inactiveProducts: 0,
    lowStockProducts: 0,
    stockValuation: 0,
    totalPurchasedQuantity: 0,
    totalPurchasedAmount: 0,
    topPurchasedProducts: []
  });
  const [productsLoading, setProductsLoading] = useState(true);
  const [productSearch, setProductSearch] = useState("");
  const debouncedProductSearch = useDebouncedValue(productSearch, 350);
  const [productCategoryFilter, setProductCategoryFilter] = useState("");
  const [productSupplierFilter, setProductSupplierFilter] = useState("");
  const [productPage, setProductPage] = useState(1);
  const [productLimit, setProductLimit] = useState(5);

  const [mutationLoading, setMutationLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrderDetail | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<ProductListItem | null>(null);

  const orderModal = useDisclosure();
  const orderDetailModal = useDisclosure();
  const productModal = useDisclosure();
  const deleteProductDialog = useDisclosure();

  const loadMeta = useCallback(
    async (date?: string) => {
      try {
        const response = await procurementService.getMeta({ date });
        setMeta(response.data);
      } catch (error) {
        toast.error("Unable to fetch procurement meta", extractErrorMessage(error));
      }
    },
    [toast]
  );

  const loadSuppliers = useCallback(async () => {
    try {
      const response = await procurementService.getSuppliers({ includeInactive: true, page: 1, limit: 200 });
      setSuppliers(response.data.suppliers);
    } catch (error) {
      toast.error("Unable to fetch suppliers", extractErrorMessage(error));
    }
  }, [toast]);

  const loadUnits = useCallback(async () => {
    try {
      const response = await procurementService.getUnits();
      setUnits([...response.data.productUnits]);
    } catch (error) {
      toast.error("Unable to fetch units", extractErrorMessage(error));
    }
  }, [toast]);

  const loadStats = useCallback(async () => {
    try {
      const response = await procurementService.getStats({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined
      });
      setStats(response.data.summary);
    } catch (error) {
      toast.error("Unable to fetch purchase stats", extractErrorMessage(error));
    }
  }, [dateFrom, dateTo, toast]);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const response = await procurementService.getPurchaseOrders({
        search: debouncedOrderSearch || undefined,
        supplierId: orderSupplierFilter || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page: orderPage,
        limit: orderLimit
      });
      setOrderRows(response.data.orders);
      setOrderPagination(response.data.pagination);
      setOrderStats(response.data.stats);
    } catch (error) {
      toast.error("Unable to fetch purchase orders", extractErrorMessage(error));
    } finally {
      setOrdersLoading(false);
    }
  }, [dateFrom, dateTo, debouncedOrderSearch, orderLimit, orderPage, orderSupplierFilter, toast]);

  const loadProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const response = await procurementService.getProducts({
        search: debouncedProductSearch || undefined,
        category: productCategoryFilter || undefined,
        supplierId: productSupplierFilter || undefined,
        includeInactive: true,
        page: productPage,
        limit: productLimit
      });
      setProductRows(response.data.products);
      setProductPagination(response.data.pagination);
      setProductStats(response.data.stats);
    } catch (error) {
      toast.error("Unable to fetch products", extractErrorMessage(error));
    } finally {
      setProductsLoading(false);
    }
  }, [debouncedProductSearch, productCategoryFilter, productLimit, productPage, productSupplierFilter, toast]);

  useEffect(() => {
    void Promise.all([loadSuppliers(), loadUnits(), loadMeta(getTodayDate())]);
  }, [loadSuppliers, loadUnits, loadMeta]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    setOrderPage(1);
  }, [debouncedOrderSearch, orderSupplierFilter, orderLimit, dateFrom, dateTo]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    setProductPage(1);
  }, [debouncedProductSearch, productCategoryFilter, productSupplierFilter, productLimit]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const supplierOptions: AppSearchableSelectOption[] = useMemo(
    () => [
      { value: "", label: "All Suppliers" },
      ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name, description: supplier.phone }))
    ],
    [suppliers]
  );

  const categoryFilterOptions: AppSearchableSelectOption[] = useMemo(() => {
    const unique = new Set(productRows.map((row) => row.category));
    return [{ value: "", label: "All Categories" }, ...Array.from(unique).map((category) => ({ value: category, label: category }))];
  }, [productRows]);

  const openCreateProduct = () => {
    setSelectedProduct(null);
    productModal.onOpen();
  };

  const openEditProduct = (row: ProductListItem) => {
    setSelectedProduct(row);
    productModal.onOpen();
  };

  const openDeleteProduct = (row: ProductListItem) => {
    setSelectedProduct(row);
    deleteProductDialog.onOpen();
  };

  const handleCreateOrder = async (payload: {
    supplierId: string;
    purchaseDate: string;
    note?: string;
    lines: CreatePurchaseLineInput[];
  }) => {
    setMutationLoading(true);
    try {
      await procurementService.createPurchaseOrder(payload);
      toast.success("Purchase order created successfully");
      orderModal.onClose();
      await Promise.all([loadOrders(), loadProducts(), loadStats(), loadMeta(payload.purchaseDate)]);
    } catch (error) {
      toast.error("Unable to create purchase order", extractErrorMessage(error));
    } finally {
      setMutationLoading(false);
    }
  };

  const handleSaveProduct = async (payload: {
    name: string;
    category: string;
    sku?: string;
    packSize?: string;
    unit: ProductUnit;
    currentStock: number;
    minStock: number;
    purchaseUnitPrice: number;
    defaultSupplierId?: string | null;
    isActive: boolean;
  }) => {
    setMutationLoading(true);
    try {
      if (selectedProduct) {
        await procurementService.updateProduct(selectedProduct.id, payload);
        toast.success("Product updated successfully");
      } else {
        await procurementService.createProduct(payload);
        toast.success("Product created successfully");
      }
      productModal.onClose();
      setSelectedProduct(null);
      await Promise.all([loadProducts(), loadStats(), loadMeta(meta?.date)]);
    } catch (error) {
      toast.error("Unable to save product", extractErrorMessage(error));
    } finally {
      setMutationLoading(false);
    }
  };

  const handleDeleteProduct = async () => {
    if (!selectedProduct) {
      return;
    }
    setMutationLoading(true);
    try {
      await procurementService.deleteProduct(selectedProduct.id);
      toast.success("Product deleted successfully");
      deleteProductDialog.onClose();
      setSelectedProduct(null);
      await Promise.all([loadProducts(), loadStats(), loadMeta(meta?.date)]);
    } catch (error) {
      toast.error("Unable to delete product", extractErrorMessage(error));
    } finally {
      setMutationLoading(false);
    }
  };

  return (
    <VStack spacing={5} align="stretch">
      <PageHeader title="Purchase" subtitle="Manage supplier purchases, ingredient restocking and packaged products." />

      <SimpleGrid columns={{ base: 2, lg: 6 }} spacing={3}>
        <AppCard p={4}><Text fontSize="sm" color="#7B645B">Purchase Orders</Text><Text fontSize="2xl" fontWeight={900}>{stats.totalPurchaseOrders}</Text></AppCard>
        <AppCard p={4}><Text fontSize="sm" color="#7B645B">Purchase Amount</Text><Text fontSize="2xl" fontWeight={900}>{formatCurrency(stats.totalPurchaseAmount)}</Text></AppCard>
        <AppCard p={4}><Text fontSize="sm" color="#7B645B">Suppliers</Text><Text fontSize="2xl" fontWeight={900}>{stats.totalSuppliers}</Text></AppCard>
        <AppCard p={4}><Text fontSize="sm" color="#7B645B">Products</Text><Text fontSize="2xl" fontWeight={900}>{stats.totalProducts}</Text></AppCard>
        <AppCard p={4}><Text fontSize="sm" color="#7B645B">Purchased Qty</Text><Text fontSize="2xl" fontWeight={900}>{stats.totalProductPurchasedQuantity}</Text></AppCard>
        <AppCard p={4}><Text fontSize="sm" color="#7B645B">Product Spend</Text><Text fontSize="2xl" fontWeight={900}>{formatCurrency(stats.totalProductPurchasedAmount)}</Text></AppCard>
      </SimpleGrid>

      <Tabs variant="soft-rounded" colorScheme="brand">
        <TabList gap={3}>
          <Tab>Purchase Orders</Tab>
          <Tab>Products</Tab>
        </TabList>
        <TabPanels pt={4}>
          <TabPanel px={0}>
            <AppCard>
              <SimpleGrid columns={{ base: 1, md: 6 }} spacing={3}>
                <AppInput label="Search" placeholder="Search purchase number or supplier" value={orderSearch} onChange={(event) => setOrderSearch((event.target as HTMLInputElement).value)} />
                <AppSearchableSelect label="Supplier" value={orderSupplierFilter} options={supplierOptions} onValueChange={setOrderSupplierFilter} />
                <AppInput label="From Date" type="date" value={dateFrom} onChange={(event) => setDateFrom((event.target as HTMLInputElement).value)} />
                <AppInput label="To Date" type="date" value={dateTo} onChange={(event) => setDateTo((event.target as HTMLInputElement).value)} />
                <FormControl>
                  <FormLabel>Rows per page</FormLabel>
                  <Select value={orderLimit} onChange={(event) => setOrderLimit(Number((event.target as HTMLSelectElement).value))} bg="white" borderColor="rgba(193, 14, 14, 0.18)" focusBorderColor="brand.400">
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                  </Select>
                </FormControl>
                <HStack justify="flex-end" align="end"><AppButton leftIcon={<Plus size={16} />} onClick={orderModal.onOpen}>New Purchase</AppButton></HStack>
              </SimpleGrid>

              <Box mt={4}>
                {ordersLoading ? (
                  <SkeletonTable rows={5} />
                ) : (
                  <DataTable
                    columns={[
                      { key: "purchaseNumber", header: "Purchase No", render: (row: PurchaseOrderSummary) => <Text fontWeight={800}>{row.purchaseNumber}</Text> },
                      { key: "supplierName", header: "Supplier", render: (row: PurchaseOrderSummary) => row.supplierName },
                      { key: "purchaseDate", header: "Date", render: (row: PurchaseOrderSummary) => formatDate(row.purchaseDate) },
                      { key: "purchaseType", header: "Type", render: (row: PurchaseOrderSummary) => row.purchaseType.toUpperCase() },
                      { key: "lineCount", header: "Lines", render: (row: PurchaseOrderSummary) => row.lineCount },
                      { key: "totalAmount", header: "Total", render: (row: PurchaseOrderSummary) => formatCurrency(row.totalAmount) },
                      { key: "action", header: "Action", render: (row: PurchaseOrderSummary) => <ActionIconButton aria-label="View details" tooltip="View details" icon={<Eye size={16} />} variant="outline" onClick={() => void procurementService.getPurchaseOrderById(row.id).then((response) => { setSelectedOrder(response.data.purchaseOrder); orderDetailModal.onOpen(); }).catch((error) => toast.error("Unable to load purchase detail", extractErrorMessage(error)))} /> }
                    ]}
                    rows={orderRows}
                    emptyState={<EmptyState title="No purchase orders found" description="Create a new purchase order to restock ingredients and products." />}
                  />
                )}
              </Box>

              <HStack justify="space-between" mt={4}>
                <Text color="#6F594F" fontSize="sm">Showing {orderRows.length} of {orderPagination.total} records</Text>
                <HStack>
                  <AppButton variant="outline" isDisabled={orderPage <= 1} onClick={() => setOrderPage((prev) => prev - 1)}>Previous</AppButton>
                  <Text fontWeight={700}>Page {orderPagination.page} of {orderPagination.totalPages}</Text>
                  <AppButton variant="outline" isDisabled={orderPagination.page >= orderPagination.totalPages} onClick={() => setOrderPage((prev) => prev + 1)}>Next</AppButton>
                </HStack>
              </HStack>
              <Text mt={2} color="#6F594F" fontSize="sm">Filtered Total Amount: {formatCurrency(orderStats.totalAmount)}</Text>
            </AppCard>
          </TabPanel>

          <TabPanel px={0}>
            <AppCard>
              <SimpleGrid columns={{ base: 1, md: 6 }} spacing={3}>
                <AppInput label="Search Product" placeholder="Search name, sku, pack size" value={productSearch} onChange={(event) => setProductSearch((event.target as HTMLInputElement).value)} />
                <AppSearchableSelect label="Category" value={productCategoryFilter} options={categoryFilterOptions} onValueChange={setProductCategoryFilter} />
                <AppSearchableSelect label="Supplier" value={productSupplierFilter} options={supplierOptions} onValueChange={setProductSupplierFilter} />
                <FormControl>
                  <FormLabel>Rows per page</FormLabel>
                  <Select value={productLimit} onChange={(event) => setProductLimit(Number((event.target as HTMLSelectElement).value))} bg="white" borderColor="rgba(193, 14, 14, 0.18)" focusBorderColor="brand.400">
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                  </Select>
                </FormControl>
                <Box />
                <HStack justify="flex-end" align="end"><AppButton leftIcon={<Plus size={16} />} onClick={openCreateProduct}>Add Product</AppButton></HStack>
              </SimpleGrid>

              <SimpleGrid mt={4} columns={{ base: 2, lg: 5 }} spacing={3}>
                <AppCard p={3}><Text fontSize="xs" color="#7B645B">Total Products</Text><Text fontSize="xl" fontWeight={900}>{productStats.totalProducts}</Text></AppCard>
                <AppCard p={3}><Text fontSize="xs" color="#7B645B">Low Stock</Text><Text fontSize="xl" fontWeight={900} color="#B91C1C">{productStats.lowStockProducts}</Text></AppCard>
                <AppCard p={3}><Text fontSize="xs" color="#7B645B">Stock Valuation</Text><Text fontSize="xl" fontWeight={900}>{formatCurrency(productStats.stockValuation)}</Text></AppCard>
                <AppCard p={3}><Text fontSize="xs" color="#7B645B">Purchased Qty</Text><Text fontSize="xl" fontWeight={900}>{productStats.totalPurchasedQuantity}</Text></AppCard>
                <AppCard p={3}><Text fontSize="xs" color="#7B645B">Purchased Amount</Text><Text fontSize="xl" fontWeight={900}>{formatCurrency(productStats.totalPurchasedAmount)}</Text></AppCard>
              </SimpleGrid>

              <AppCard mt={4} p={4}>
                <Text fontWeight={800} mb={3}>
                  Top Purchased Products
                </Text>
                {productStats.topPurchasedProducts.length ? (
                  <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} spacing={3}>
                    {productStats.topPurchasedProducts.map((entry) => (
                      <Box
                        key={entry.productId}
                        border="1px solid"
                        borderColor="rgba(133, 78, 48, 0.22)"
                        borderRadius="12px"
                        p={3}
                        bg="white"
                      >
                        <Text fontWeight={800}>{entry.name}</Text>
                        <Text fontSize="sm" color="#7A6359">
                          {entry.quantity} {entry.unit}
                        </Text>
                      </Box>
                    ))}
                  </SimpleGrid>
                ) : (
                  <Text color="#7A6359">No purchase movement yet.</Text>
                )}
              </AppCard>

              <Box mt={4}>
                {productsLoading ? (
                  <SkeletonTable rows={5} />
                ) : (
                  <DataTable
                    columns={[
                      { key: "name", header: "Product", render: (row: ProductListItem) => <Box><Text fontWeight={800}>{row.name}</Text><Text fontSize="sm" color="#7A6359">{row.sku || "-"}{row.packSize ? ` | ${row.packSize}` : ""}</Text></Box> },
                      { key: "category", header: "Category", render: (row: ProductListItem) => row.category },
                      { key: "stock", header: "Stock", render: (row: ProductListItem) => `${row.currentStock} ${row.unit}` },
                      { key: "minStock", header: "Min Stock", render: (row: ProductListItem) => `${row.minStock} ${row.unit}` },
                      { key: "price", header: "Unit Price", render: (row: ProductListItem) => formatCurrency(row.purchaseUnitPrice) },
                      { key: "valuation", header: "Valuation", render: (row: ProductListItem) => formatCurrency(row.valuation) },
                      { key: "status", header: "Status", render: (row: ProductListItem) => <Box px={3} py={1} borderRadius="full" bg={row.stockStatus === "LOW_STOCK" ? "red.100" : "green.100"} color={row.stockStatus === "LOW_STOCK" ? "red.700" : "green.700"} fontSize="xs" fontWeight={700} w="fit-content">{row.stockStatus === "LOW_STOCK" ? "Low Stock" : "Healthy"}</Box> },
                      { key: "actions", header: "Actions", render: (row: ProductListItem) => <HStack spacing={2}><ActionIconButton aria-label="Edit product" tooltip="Edit product" icon={<Edit2 size={16} />} variant="outline" onClick={() => openEditProduct(row)} /><ActionIconButton aria-label="Delete product" tooltip="Delete product" icon={<Trash2 size={16} />} variant="outline" colorScheme="accentRed" onClick={() => openDeleteProduct(row)} /></HStack> }
                    ]}
                    rows={productRows}
                    emptyState={<EmptyState title="No products found" description="Add products like 7up, chocolate, tin items and track stock." />}
                  />
                )}
              </Box>

              <HStack justify="space-between" mt={4}>
                <Text color="#6F594F" fontSize="sm">Showing {productRows.length} of {productPagination.total} records</Text>
                <HStack>
                  <AppButton variant="outline" isDisabled={productPage <= 1} onClick={() => setProductPage((prev) => prev - 1)}>Previous</AppButton>
                  <Text fontWeight={700}>Page {productPagination.page} of {productPagination.totalPages}</Text>
                  <AppButton variant="outline" isDisabled={productPagination.page >= productPagination.totalPages} onClick={() => setProductPage((prev) => prev + 1)}>Next</AppButton>
                </HStack>
              </HStack>
            </AppCard>
          </TabPanel>
        </TabPanels>
      </Tabs>

      <PurchaseOrderModal
        isOpen={orderModal.isOpen}
        onClose={orderModal.onClose}
        loading={mutationLoading}
        meta={meta}
        onLoadMetaForDate={loadMeta}
        onSubmit={handleCreateOrder}
      />

      <ProductFormModal
        isOpen={productModal.isOpen}
        onClose={() => {
          productModal.onClose();
          setSelectedProduct(null);
        }}
        loading={mutationLoading}
        initialData={selectedProduct}
        suppliers={suppliers}
        units={units}
        onSubmit={handleSaveProduct}
      />

      <Modal isOpen={orderDetailModal.isOpen} onClose={orderDetailModal.onClose} size="4xl" closeOnOverlayClick={false}>
        <ModalOverlay />
        <ModalContent borderRadius="16px">
          <ModalHeader>Purchase Order Details</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {selectedOrder ? (
              <VStack spacing={4} align="stretch">
                <SimpleGrid columns={{ base: 1, md: 4 }} spacing={3}>
                  <AppCard p={3}><Text fontSize="xs" color="#7B645B">Purchase No</Text><Text fontWeight={900}>{selectedOrder.purchaseNumber}</Text></AppCard>
                  <AppCard p={3}><Text fontSize="xs" color="#7B645B">Supplier</Text><Text fontWeight={900}>{selectedOrder.supplierName}</Text></AppCard>
                  <AppCard p={3}><Text fontSize="xs" color="#7B645B">Date</Text><Text fontWeight={900}>{formatDate(selectedOrder.purchaseDate)}</Text></AppCard>
                  <AppCard p={3}><Text fontSize="xs" color="#7B645B">Total</Text><Text fontWeight={900}>{formatCurrency(selectedOrder.totalAmount)}</Text></AppCard>
                </SimpleGrid>
                <DataTable columns={[{ key: "itemNameSnapshot", header: "Item" }, { key: "lineType", header: "Type", render: (row: any) => String(row.lineType).toUpperCase() }, { key: "stockAdded", header: "Added", render: (row: any) => `${row.stockAdded} ${row.unit}` }, { key: "unitPrice", header: "Unit Price", render: (row: any) => formatCurrency(row.unitPrice) }, { key: "lineTotal", header: "Line Total", render: (row: any) => formatCurrency(row.lineTotal) }]} rows={selectedOrder.lines as any} />
              </VStack>
            ) : null}
          </ModalBody>
          <ModalFooter><AppButton variant="outline" onClick={orderDetailModal.onClose}>Close</AppButton></ModalFooter>
        </ModalContent>
      </Modal>

      <ConfirmDialog
        isOpen={deleteProductDialog.isOpen}
        title="Delete product?"
        description={selectedProduct ? `Are you sure you want to delete ${selectedProduct.name}?` : "Are you sure?"}
        onClose={() => {
          deleteProductDialog.onClose();
          setSelectedProduct(null);
        }}
        onConfirm={() => void handleDeleteProduct()}
        isLoading={mutationLoading}
      />
    </VStack>
  );
};



