const express = require("express");
const auth = require("../middleware/auth.middleware");
const templatesController = require("../controllers/templates.controller");

const router = express.Router();

router.get("/", auth, templatesController.getTemplates);
router.get("/:id", auth, templatesController.getTemplateById);
router.post("/", auth, templatesController.createTemplate);
router.put("/:id", auth, templatesController.updateTemplate);
router.delete("/:id", auth, templatesController.deleteTemplate);
router.post("/:id/set-default", auth, templatesController.setDefaultTemplate);

module.exports = router;