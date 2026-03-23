import { Router } from "express";

import { UserRole } from "../../constants/roles";
import { asyncHandler } from "../../middlewares/async-handler";
import { authenticate, authorizeRoles } from "../../middlewares/auth.middleware";
import { validateRequest } from "../../middlewares/validate.middleware";
import { IngredientsController } from "./ingredients.controller";
import {
  addIngredientStockSchema,
  adjustIngredientStockSchema,
  allocationListSchema,
  allocationStatsSchema,
  assignAllAllocationSchema,
  closingReportListSchema,
  closingStatusSchema,
  continueYesterdayAllocationSchema,
  createIngredientCategorySchema,
  createIngredientSchema,
  deleteIngredientCategorySchema,
  deleteIngredientSchema,
  ingredientCategoryListSchema,
  ingredientListSchema,
  ingredientStockSchema,
  saveAllocationSchema,
  stockAuditSchema,
  submitClosingReportSchema,
  updatePosBillingControlSchema,
  updateAllocationSchema,
  updateIngredientCategorySchema,
  updateIngredientSchema
} from "./ingredients.validation";

const router = Router();
const ingredientsController = new IngredientsController();

router.use(authenticate);

router.get(
  "/pos-billing-control",
  authorizeRoles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.STAFF, UserRole.SNOOKER_STAFF),
  asyncHandler(ingredientsController.getPosBillingControl)
);
router.get(
  "/closing/status",
  authorizeRoles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.STAFF, UserRole.SNOOKER_STAFF),
  validateRequest(closingStatusSchema),
  asyncHandler(ingredientsController.getClosingStatus)
);
router.post(
  "/closing/reports",
  authorizeRoles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.STAFF, UserRole.SNOOKER_STAFF),
  validateRequest(submitClosingReportSchema),
  asyncHandler(ingredientsController.submitClosingReport)
);
router.get(
  "/closing/reports",
  authorizeRoles(UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.STAFF, UserRole.SNOOKER_STAFF),
  validateRequest(closingReportListSchema),
  asyncHandler(ingredientsController.listClosingReports)
);

router.use(authorizeRoles(UserRole.ADMIN));

router.patch(
  "/pos-billing-control",
  validateRequest(updatePosBillingControlSchema),
  asyncHandler(ingredientsController.updatePosBillingControl)
);
router.get("/stock-audit", validateRequest(stockAuditSchema), asyncHandler(ingredientsController.getStockAudit));

router.get("/categories", validateRequest(ingredientCategoryListSchema), asyncHandler(ingredientsController.listCategories));
router.post("/categories", validateRequest(createIngredientCategorySchema), asyncHandler(ingredientsController.createCategory));
router.patch(
  "/categories/:id",
  validateRequest(updateIngredientCategorySchema),
  asyncHandler(ingredientsController.updateCategory)
);
router.delete(
  "/categories/:id",
  validateRequest(deleteIngredientCategorySchema),
  asyncHandler(ingredientsController.deleteCategory)
);

router.get("/", validateRequest(ingredientListSchema), asyncHandler(ingredientsController.listIngredients));
router.post("/", validateRequest(createIngredientSchema), asyncHandler(ingredientsController.createIngredient));
router.patch("/:id", validateRequest(updateIngredientSchema), asyncHandler(ingredientsController.updateIngredient));
router.delete("/:id", validateRequest(deleteIngredientSchema), asyncHandler(ingredientsController.deleteIngredient));

router.get("/allocations", validateRequest(allocationListSchema), asyncHandler(ingredientsController.getAllocations));
router.get(
  "/allocations/stats",
  validateRequest(allocationStatsSchema),
  asyncHandler(ingredientsController.getAllocationStats)
);
router.post(
  "/allocations/assign-all",
  validateRequest(assignAllAllocationSchema),
  asyncHandler(ingredientsController.assignAllStockToDate)
);
router.post(
  "/allocations/continue-yesterday",
  validateRequest(continueYesterdayAllocationSchema),
  asyncHandler(ingredientsController.continueYesterdayAllocation)
);
router.post("/allocations", validateRequest(saveAllocationSchema), asyncHandler(ingredientsController.saveAllocation));
router.patch(
  "/allocations/:id",
  validateRequest(updateAllocationSchema),
  asyncHandler(ingredientsController.updateAllocation)
);

router.get("/:id/stock", validateRequest(ingredientStockSchema), asyncHandler(ingredientsController.getIngredientStock));
router.post("/:id/stock/add", validateRequest(addIngredientStockSchema), asyncHandler(ingredientsController.addStock));
router.post(
  "/:id/stock/adjust",
  validateRequest(adjustIngredientStockSchema),
  asyncHandler(ingredientsController.adjustStock)
);

export const ingredientsRoutes = router;
