const templatesService = require("../services/templates.service");

function isValidTemplateContent(contentJson) {
  if (!contentJson || typeof contentJson !== "object") return false;
  if (!Array.isArray(contentJson.sections)) return false;
  if (contentJson.sections.length === 0) return false;

  for (const section of contentJson.sections) {
    if (!section || typeof section !== "object") return false;
    if (!section.key || typeof section.key !== "string") return false;
    if (!section.label || typeof section.label !== "string") return false;
  }

  return true;
}

function buildPreviewText(contentJson) {
  if (!contentJson?.sections?.length) return "";
  return contentJson.sections
    .map((section) => section.label)
    .slice(0, 4)
    .join(", ");
}

function sanitizeTemplateContent(contentJson) {
  return {
    ...contentJson,
    sections: contentJson.sections.map((section) => ({
      key: section.key,
      label: section.label,
      enabled: section.enabled !== false,
      inputType: section.inputType || "textarea",
    })),
  };
}

async function getTemplates(req, res, next) {
  try {
    const userId = req.user.userId;
    const data = await templatesService.getTemplatesForUser(userId);
    return res.json(data);
  } catch (error) {
    next(error);
  }
}

async function getTemplateById(req, res, next) {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const template = await templatesService.getTemplateById(id, userId);

    if (!template) {
      return res.status(404).json({ message: "Template not found." });
    }

    return res.json({
      id: template.id,
      name: template.name,
      slug: template.slug,
      description: template.description,
      category: template.category,
      visibility: template.visibility,
      ownerUserId: template.owner_user_id,
      contentJson: template.content_json,
      previewText: template.preview_text,
      createdAt: template.created_at,
      updatedAt: template.updated_at,
    });
  } catch (error) {
    next(error);
  }
}

async function createTemplate(req, res, next) {
  try {
    const userId = req.user.userId;
    const { name, description, category, contentJson } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Template name is required." });
    }

    if (name.trim().length > 150) {
      return res.status(400).json({ message: "Template name is too long." });
    }

    if (!isValidTemplateContent(contentJson)) {
      return res.status(400).json({
        message: "Invalid template content. At least one valid section is required.",
      });
    }

    const sanitizedContent = sanitizeTemplateContent(contentJson);
    const previewText = buildPreviewText(sanitizedContent);

    const created = await templatesService.createCustomTemplate({
      userId,
      name: name.trim(),
      description: description?.trim() || null,
      category: category?.trim() || "general",
      contentJson: sanitizedContent,
      previewText,
    });

    await templatesService.trackTemplateEvent({
      templateId: created.id,
      userId,
      eventType: "created",
      meta: { source: "custom_template_form" },
    });

    return res.status(201).json({
      message: "Template created successfully.",
      template: {
        id: created.id,
        name: created.name,
        slug: created.slug,
        description: created.description,
        category: created.category,
        visibility: created.visibility,
        ownerUserId: created.owner_user_id,
        contentJson: created.content_json,
        previewText: created.preview_text,
        createdAt: created.created_at,
        updatedAt: created.updated_at,
      },
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        message: "You already have a template with this name.",
      });
    }

    next(error);
  }
}

async function updateTemplate(req, res, next) {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { name, description, category, contentJson } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Template name is required." });
    }

    if (!isValidTemplateContent(contentJson)) {
      return res.status(400).json({
        message: "Invalid template content. At least one valid section is required.",
      });
    }

    const sanitizedContent = sanitizeTemplateContent(contentJson);
    const previewText = buildPreviewText(sanitizedContent);

    const updated = await templatesService.updateCustomTemplate({
      templateId: id,
      userId,
      name: name.trim(),
      description: description?.trim() || null,
      category: category?.trim() || "general",
      contentJson: sanitizedContent,
      previewText,
    });

    if (!updated) {
      return res.status(404).json({ message: "Custom template not found." });
    }

    await templatesService.trackTemplateEvent({
      templateId: updated.id,
      userId,
      eventType: "updated",
      meta: { source: "custom_template_edit" },
    });

    return res.json({
      message: "Template updated successfully.",
      template: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        description: updated.description,
        category: updated.category,
        visibility: updated.visibility,
        ownerUserId: updated.owner_user_id,
        contentJson: updated.content_json,
        previewText: updated.preview_text,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      },
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        message: "You already have a template with this name.",
      });
    }

    next(error);
  }
}

async function deleteTemplate(req, res, next) {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const deleted = await templatesService.deleteCustomTemplate(id, userId);

    if (!deleted) {
      return res.status(404).json({ message: "Custom template not found." });
    }

    await templatesService.trackTemplateEvent({
      templateId: id,
      userId,
      eventType: "deleted",
      meta: { source: "templates_page" },
    });

    return res.json({ message: "Template deleted successfully." });
  } catch (error) {
    next(error);
  }
}

async function setDefaultTemplate(req, res, next) {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const result = await templatesService.setDefaultTemplate(userId, id);

    if (!result) {
      return res.status(404).json({ message: "Template not found." });
    }

    await templatesService.trackTemplateEvent({
      templateId: id,
      userId,
      eventType: "set_default",
      meta: { source: "templates_page" },
    });

    return res.json({
      message: "Default template updated successfully.",
      defaultTemplateId: result.default_template_id,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  setDefaultTemplate,
};
