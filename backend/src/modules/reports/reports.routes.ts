import { Router } from "express";

import { UserRole } from "../../constants/roles";
import { asyncHandler } from "../../middlewares/async-handler";
import { authenticate, authorizeRoles } from "../../middlewares/auth.middleware";
import { validateRequest } from "../../middlewares/validate.middleware";
import { ReportsController } from "./reports.controller";
import { generateReportSchema, reportsCatalogSchema } from "./reports.validation";

const router = Router();
const reportsController = new ReportsController();

router.use(
  authenticate,
  authorizeRoles(
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.STAFF,
    UserRole.SNOOKER_STAFF
  )
);

router.get("/catalog", validateRequest(reportsCatalogSchema), asyncHandler(reportsController.getCatalog));
router.get("/generate", validateRequest(generateReportSchema), asyncHandler(reportsController.generateReport));

export const reportsRoutes = router;

