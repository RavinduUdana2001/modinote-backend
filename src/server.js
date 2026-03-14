const express = require("express");
const dns = require("dns");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const dotenv = require("dotenv");


const envPath = path.resolve(__dirname, "../.env");
process.env.APP_ENV_PATH = envPath;
dotenv.config({ path: envPath });

const authRoutes = require("./routes/auth.routes");
const templatesRoutes = require("./routes/templates.routes");
const profileRoutes = require("./routes/profile.routes");
const settingsRoutes = require("./routes/settings.routes");
const voiceRoutes = require("./routes/voice.routes");
const errorHandler = require("./middleware/error.middleware");
const {
  uploadsDir,
  cleanupVoiceTempDirectories,
} = require("./config/uploads");

dns.setDefaultResultOrder("ipv4first");
cleanupVoiceTempDirectories();

const app = express();
app.set("trust proxy", 1);

const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json({ limit: "10mb" }));

app.use("/uploads", express.static(uploadsDir));

app.get("/", (req, res) => {
  res.json({
    message: "MediNote API running",
    environment: process.env.NODE_ENV || "development",
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/templates", templatesRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/voice", voiceRoutes);

app.use(errorHandler);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Uploads directory: ${uploadsDir}`);
  console.log(`Environment file: ${envPath}`);
});
