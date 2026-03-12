function errorHandler(err, req, res, next) {
  console.error("Unhandled error:", err);

  if (res.headersSent) {
    return next(err);
  }

  return res.status(500).json({
    message: "Internal server error.",
  });
}

module.exports = errorHandler;