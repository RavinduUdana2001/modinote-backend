function errorHandler(err, req, res, next) {
  console.error("Unhandled error:", err);

  if (res.headersSent) {
    return next(err);
  }

  const statusCode =
    err.code === "LIMIT_FILE_SIZE"
      ? 400
      : err.statusCode || 500;
  const message =
    err.code === "LIMIT_FILE_SIZE"
      ? "Audio file is too large for transcription."
      : err.message || "Internal server error.";

  return res.status(statusCode).json({
    message,
    details: err.details || null,
    stack: process.env.NODE_ENV !== "production" ? err.stack : undefined,
  });
}

module.exports = errorHandler;
