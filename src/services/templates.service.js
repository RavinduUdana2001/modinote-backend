const pool = require("../db");

async function getTemplatesForUser(userId) {
  const templatesQuery = `
    SELECT
      id,
      name,
      slug,
      description,
      category,
      visibility,
      owner_user_id,
      content_json,
      preview_text,
      created_at,
      updated_at
    FROM templates
    WHERE is_active = true
      AND (
        visibility = 'system'
        OR owner_user_id = $1
      )
    ORDER BY
      CASE WHEN visibility = 'system' THEN 0 ELSE 1 END,
      LOWER(name) ASC
  `;

  const defaultQuery = `
    SELECT default_template_id
    FROM user_template_preferences
    WHERE user_id = $1
  `;

  const [templatesRes, defaultRes] = await Promise.all([
    pool.query(templatesQuery, [userId]),
    pool.query(defaultQuery, [userId]),
  ]);

  const defaultTemplateId = defaultRes.rows[0]?.default_template_id || null;

  const systemTemplates = [];
  const customTemplates = [];

  for (const row of templatesRes.rows) {
    const mapped = {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      category: row.category,
      visibility: row.visibility,
      ownerUserId: row.owner_user_id,
      contentJson: row.content_json,
      previewText: row.preview_text,
      isDefault: row.id === defaultTemplateId,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    if (row.visibility === "system") {
      systemTemplates.push(mapped);
    } else {
      customTemplates.push(mapped);
    }
  }

  return {
    defaultTemplateId,
    systemTemplates,
    customTemplates,
  };
}

async function getTemplateById(templateId, userId) {
  const query = `
    SELECT
      id,
      name,
      slug,
      description,
      category,
      visibility,
      owner_user_id,
      content_json,
      preview_text,
      created_at,
      updated_at
    FROM templates
    WHERE id = $1
      AND is_active = true
      AND (
        visibility = 'system'
        OR owner_user_id = $2
      )
    LIMIT 1
  `;

  const result = await pool.query(query, [templateId, userId]);
  return result.rows[0] || null;
}

async function createCustomTemplate({
  userId,
  name,
  description,
  category,
  contentJson,
  previewText,
}) {
  const query = `
    INSERT INTO templates (
      name,
      slug,
      description,
      category,
      visibility,
      owner_user_id,
      content_json,
      preview_text,
      created_by,
      updated_by
    )
    VALUES (
      $1,
      NULL,
      $2,
      $3,
      'private',
      $4,
      $5::jsonb,
      $6,
      $4,
      $4
    )
    RETURNING
      id,
      name,
      slug,
      description,
      category,
      visibility,
      owner_user_id,
      content_json,
      preview_text,
      created_at,
      updated_at
  `;

  const values = [
    name,
    description || null,
    category || "general",
    userId,
    JSON.stringify(contentJson),
    previewText || null,
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

async function updateCustomTemplate({
  templateId,
  userId,
  name,
  description,
  category,
  contentJson,
  previewText,
}) {
  const query = `
    UPDATE templates
    SET
      name = $1,
      description = $2,
      category = $3,
      content_json = $4::jsonb,
      preview_text = $5,
      updated_by = $6
    WHERE id = $7
      AND owner_user_id = $6
      AND visibility = 'private'
      AND is_active = true
    RETURNING
      id,
      name,
      slug,
      description,
      category,
      visibility,
      owner_user_id,
      content_json,
      preview_text,
      created_at,
      updated_at
  `;

  const result = await pool.query(query, [
    name,
    description || null,
    category || "general",
    JSON.stringify(contentJson),
    previewText || null,
    userId,
    templateId,
  ]);

  return result.rows[0] || null;
}

async function deleteCustomTemplate(templateId, userId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const query = `
      UPDATE templates
      SET
        is_active = false,
        updated_by = $2
      WHERE id = $1
        AND owner_user_id = $2
        AND visibility = 'private'
        AND is_active = true
      RETURNING id
    `;

    const result = await client.query(query, [templateId, userId]);

    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }

    await client.query(
      `
      UPDATE user_template_preferences
      SET
        default_template_id = NULL,
        updated_at = NOW()
      WHERE user_id = $1
        AND default_template_id = $2
      `,
      [userId, templateId]
    );

    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function setDefaultTemplate(userId, templateId) {
  const checkQuery = `
    SELECT id
    FROM templates
    WHERE id = $1
      AND is_active = true
      AND (
        visibility = 'system'
        OR owner_user_id = $2
      )
    LIMIT 1
  `;

  const checkRes = await pool.query(checkQuery, [templateId, userId]);

  if (checkRes.rows.length === 0) {
    return null;
  }

  const upsertQuery = `
    INSERT INTO user_template_preferences (user_id, default_template_id)
    VALUES ($1, $2)
    ON CONFLICT (user_id)
    DO UPDATE SET
      default_template_id = EXCLUDED.default_template_id,
      updated_at = NOW()
    RETURNING user_id, default_template_id, updated_at
  `;

  const result = await pool.query(upsertQuery, [userId, templateId]);
  return result.rows[0];
}

async function trackTemplateEvent({ templateId, userId, eventType, meta = null }) {
  const query = `
    INSERT INTO template_usage_events (
      template_id,
      user_id,
      event_type,
      meta
    )
    VALUES ($1, $2, $3, $4::jsonb)
    RETURNING id
  `;

  await pool.query(query, [
    templateId,
    userId || null,
    eventType,
    meta ? JSON.stringify(meta) : null,
  ]);
}

module.exports = {
  getTemplatesForUser,
  getTemplateById,
  createCustomTemplate,
  updateCustomTemplate,
  deleteCustomTemplate,
  setDefaultTemplate,
  trackTemplateEvent,
};
