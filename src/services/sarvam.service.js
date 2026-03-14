const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

const AUTO_LANGUAGE_CODE = "unknown";
const ENGLISH_LANGUAGE_CODE = "en-IN";

class SarvamServiceError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = "SarvamServiceError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

function getSarvamConfig() {
  const apiKey = process.env.SARVAM_API_KEY;
  const baseUrl = (process.env.SARVAM_BASE_URL || "https://api.sarvam.ai").replace(
    /\/+$/,
    "",
  );
  const timeoutMs = Number(process.env.SARVAM_TIMEOUT_MS || 120000);
  const batchPollIntervalMs = Number(
    process.env.SARVAM_BATCH_POLL_INTERVAL_MS || 3000,
  );
  const batchMaxWaitMs = Number(process.env.SARVAM_BATCH_MAX_WAIT_MS || 900000);
  const restMaxDurationSeconds = Number(
    process.env.SARVAM_REST_MAX_DURATION_SECONDS || 30,
  );
  const model = process.env.SARVAM_STT_MODEL || "saaras:v3";
  const mode = process.env.SARVAM_STT_MODE || "translate";
  const debug = String(process.env.SARVAM_DEBUG || "").toLowerCase() === "true";

  if (!apiKey) {
    throw new SarvamServiceError(
      "Sarvam API key is missing on the server.",
      500,
    );
  }

  return {
    apiKey,
    baseUrl,
    timeoutMs,
    batchPollIntervalMs,
    batchMaxWaitMs,
    restMaxDurationSeconds,
    model,
    mode,
    debug,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeLanguageCode(languageCode, captureMode) {
  if (!languageCode || languageCode === "auto") {
    return captureMode === "dictate"
      ? ENGLISH_LANGUAGE_CODE
      : AUTO_LANGUAGE_CODE;
  }

  return languageCode;
}

function normalizeTranscriptResponse(data) {
  const transcript =
    data?.transcript ||
    data?.translated_text ||
    data?.text ||
    data?.data?.transcript ||
    data?.data?.translated_text ||
    "";

  const languageCode =
    data?.language_code ||
    data?.detected_language ||
    data?.source_language ||
    data?.data?.language_code ||
    null;

  const requestId =
    data?.request_id ||
    data?.requestId ||
    data?.data?.request_id ||
    null;

  const languageProbability =
    data?.language_probability ||
    data?.data?.language_probability ||
    null;

  const timestamps =
    data?.timestamps ||
    data?.data?.timestamps ||
    null;

  const diarizedEntries = Array.isArray(data?.diarized_transcript?.entries)
    ? data.diarized_transcript.entries
    : Array.isArray(data?.data?.diarized_transcript?.entries)
      ? data.data.diarized_transcript.entries
      : [];

  return {
    transcript: String(transcript || "").trim(),
    languageCode,
    requestId,
    languageProbability,
    timestamps,
    diarizedEntries,
    raw: data,
  };
}

function buildAttemptQueue({ mode, preferredLanguageCode, captureMode }) {
  const attempts = [];
  const defaultLanguageCode = normalizeLanguageCode(
    preferredLanguageCode,
    captureMode,
  );

  function addAttempt(nextMode, languageCode) {
    const key = `${nextMode}:${languageCode || ""}`;
    if (!attempts.some((attempt) => attempt.key === key)) {
      attempts.push({
        key,
        mode: nextMode,
        languageCode,
      });
    }
  }

  addAttempt(mode, defaultLanguageCode);

  if (defaultLanguageCode !== AUTO_LANGUAGE_CODE) {
    addAttempt(mode, AUTO_LANGUAGE_CODE);
  }

  if (defaultLanguageCode !== ENGLISH_LANGUAGE_CODE) {
    addAttempt(mode, ENGLISH_LANGUAGE_CODE);
  }

  if (mode === "translate") {
    addAttempt("transcribe", ENGLISH_LANGUAGE_CODE);
  }

  return attempts;
}

function isRestDurationLimitError(error) {
  const message =
    error?.details?.error?.message ||
    error?.message ||
    "";

  return (
    error instanceof SarvamServiceError &&
    error.statusCode === 400 &&
    String(message).toLowerCase().includes("duration greater than 30 seconds")
  );
}

function getWavDurationSeconds(filePath) {
  try {
    const header = Buffer.alloc(44);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, header, 0, 44, 0);
    fs.closeSync(fd);

    if (header.toString("ascii", 0, 4) !== "RIFF") return null;
    if (header.toString("ascii", 8, 12) !== "WAVE") return null;

    const byteRate = header.readUInt32LE(28);
    const dataSize = header.readUInt32LE(40);

    if (!byteRate || !dataSize) return null;

    return Number((dataSize / byteRate).toFixed(2));
  } catch {
    return null;
  }
}

function getDurationSeconds({ durationSeconds, filePath }) {
  const numericDuration = Number(durationSeconds);
  if (Number.isFinite(numericDuration) && numericDuration > 0) {
    return numericDuration;
  }

  if (filePath) {
    return getWavDurationSeconds(filePath);
  }

  return null;
}

function buildBatchJobParameters({
  config,
  mode,
  preferredLanguageCode,
  withDiarization,
  numSpeakers,
  withTimestamps,
}) {
  const languageCode =
    preferredLanguageCode && preferredLanguageCode !== AUTO_LANGUAGE_CODE
      ? preferredLanguageCode
      : null;

  const jobParameters = {
    model: config.model,
    mode,
  };

  if (languageCode) {
    jobParameters.language_code = languageCode;
  }

  if (withDiarization) {
    jobParameters.with_diarization = true;
    jobParameters.num_speakers = numSpeakers || 2;
  }

  if (withTimestamps) {
    jobParameters.with_timestamps = true;
  }

  return jobParameters;
}

function getRequestHeaders(config, contentType = "application/json") {
  return {
    "api-subscription-key": config.apiKey,
    "Content-Type": contentType,
  };
}

function createUpstreamSarvamError(error, config, fallbackMessage) {
  if (error instanceof SarvamServiceError) {
    return error;
  }

  const upstreamStatus = error.response?.status;
  const upstreamData = error.response?.data || null;
  const message =
    upstreamData?.error?.message ||
    upstreamData?.message ||
    upstreamData?.detail ||
    error.message ||
    fallbackMessage;

  return new SarvamServiceError(
    message,
    upstreamStatus && upstreamStatus >= 400 && upstreamStatus < 500
      ? upstreamStatus
      : 502,
    config.debug ? upstreamData : null,
  );
}

async function requestTranscription({
  buffer,
  filename,
  mimeType,
  mode,
  languageCode,
}) {
  const config = getSarvamConfig();
  const form = new FormData();

  form.append("file", buffer, {
    filename,
    contentType: mimeType,
  });
  form.append("model", config.model);
  form.append("mode", mode || config.mode);
  if (languageCode) {
    form.append("language_code", languageCode);
  }

  try {
    const response = await axios.post(`${config.baseUrl}/speech-to-text`, form, {
      headers: {
        ...form.getHeaders(),
        "api-subscription-key": config.apiKey,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: config.timeoutMs,
    });

    const normalized = normalizeTranscriptResponse(response.data);

    if (!normalized.transcript) {
      throw new SarvamServiceError(
        "Sarvam returned an empty transcript.",
        502,
        config.debug ? response.data : null,
      );
    }

    return normalized;
  } catch (error) {
    if (error instanceof SarvamServiceError) {
      throw error;
    }
    throw createUpstreamSarvamError(
      error,
      config,
      "Sarvam transcription request failed.",
    );
  }
}

async function createBatchJob({
  config,
  mode,
  preferredLanguageCode,
  withDiarization,
  numSpeakers,
  withTimestamps,
}) {
  const response = await axios.post(
    `${config.baseUrl}/speech-to-text/job/v1`,
    {
      job_parameters: buildBatchJobParameters({
        config,
        mode,
        preferredLanguageCode,
        withDiarization,
        numSpeakers,
        withTimestamps,
      }),
    },
    {
      headers: getRequestHeaders(config),
      timeout: config.timeoutMs,
    },
  );

  return response.data;
}

async function getBatchUploadUrls({ config, jobId, fileName }) {
  const response = await axios.post(
    `${config.baseUrl}/speech-to-text/job/v1/upload-files`,
    {
      job_id: jobId,
      files: [fileName],
    },
    {
      headers: getRequestHeaders(config),
      timeout: config.timeoutMs,
    },
  );

  return response.data;
}

async function uploadBatchInputFile({
  fileUrl,
  filePath,
  mimeType,
  fileSize,
}) {
  const stream = fs.createReadStream(filePath);

  try {
    await axios.put(fileUrl, stream, {
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": mimeType || "application/octet-stream",
        "Content-Length": fileSize,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 0,
    });
  } finally {
    stream.destroy();
  }
}

async function startBatchJob({ config, jobId }) {
  const response = await axios.post(
    `${config.baseUrl}/speech-to-text/job/v1/${jobId}/start`,
    {},
    {
      headers: {
        "api-subscription-key": config.apiKey,
      },
      timeout: config.timeoutMs,
    },
  );

  return response.data;
}

async function getBatchJobStatus({ config, jobId }) {
  const response = await axios.get(
    `${config.baseUrl}/speech-to-text/job/v1/${jobId}/status`,
    {
      headers: {
        "api-subscription-key": config.apiKey,
      },
      timeout: config.timeoutMs,
    },
  );

  return response.data;
}

async function waitForBatchCompletion({ config, jobId }) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < config.batchMaxWaitMs) {
    const status = await getBatchJobStatus({ config, jobId });

    if (status.job_state === "Completed") {
      return status;
    }

    if (status.job_state === "Failed") {
      throw new SarvamServiceError(
        status.error_message || "Sarvam batch transcription failed.",
        502,
        config.debug ? status : null,
      );
    }

    await sleep(config.batchPollIntervalMs);
  }

  throw new SarvamServiceError(
    "Sarvam batch transcription timed out while waiting for completion.",
    504,
  );
}

function getOutputFileNameFromStatus(status) {
  const successfulDetail = (status.job_details || []).find(
    (detail) => detail.state === "Success" && detail.outputs?.length,
  );

  return successfulDetail?.outputs?.[0]?.file_name || null;
}

function getBatchFailureMessage(status) {
  const failedDetail = (status.job_details || []).find(
    (detail) => detail.state !== "Success" && detail.error_message,
  );

  return failedDetail?.error_message || status.error_message || null;
}

async function getBatchDownloadUrls({ config, jobId, fileName }) {
  const response = await axios.post(
    `${config.baseUrl}/speech-to-text/job/v1/download-files`,
    {
      job_id: jobId,
      files: [fileName],
    },
    {
      headers: getRequestHeaders(config),
      timeout: config.timeoutMs,
    },
  );

  return response.data;
}

async function transcribeViaBatch({
  filePath,
  filename,
  mimeType,
  mode,
  preferredLanguageCode,
  withDiarization,
  numSpeakers,
  withTimestamps,
}) {
  const config = getSarvamConfig();
  try {
    const fileStats = fs.statSync(filePath);
    const job = await createBatchJob({
      config,
      mode: mode || config.mode,
      preferredLanguageCode,
      withDiarization,
      numSpeakers,
      withTimestamps,
    });
    const uploadData = await getBatchUploadUrls({
      config,
      jobId: job.job_id,
      fileName: filename,
    });
    const fileUrl = uploadData?.upload_urls?.[filename]?.file_url;

    if (!fileUrl) {
      throw new SarvamServiceError(
        "Sarvam batch upload URL was not returned.",
        502,
        config.debug ? uploadData : null,
      );
    }

    await uploadBatchInputFile({
      fileUrl,
      filePath,
      mimeType,
      fileSize: fileStats.size,
    });

    await startBatchJob({
      config,
      jobId: job.job_id,
    });

    const status = await waitForBatchCompletion({
      config,
      jobId: job.job_id,
    });
    const outputFileName = getOutputFileNameFromStatus(status);

    if (!outputFileName) {
      throw new SarvamServiceError(
        getBatchFailureMessage(status) ||
          "Sarvam batch job completed without an output file.",
        502,
        config.debug ? status : null,
      );
    }

    const downloadData = await getBatchDownloadUrls({
      config,
      jobId: job.job_id,
      fileName: outputFileName,
    });
    const downloadUrl = downloadData?.download_urls?.[outputFileName]?.file_url;

    if (!downloadUrl) {
      throw new SarvamServiceError(
        "Sarvam batch download URL was not returned.",
        502,
        config.debug ? downloadData : null,
      );
    }

    const outputResponse = await axios.get(downloadUrl, {
      timeout: config.timeoutMs,
    });
    const normalized = normalizeTranscriptResponse(outputResponse.data);

    if (!normalized.transcript) {
      throw new SarvamServiceError(
        "Sarvam batch job completed but returned an empty transcript.",
        502,
        config.debug ? outputResponse.data : null,
      );
    }

    return {
      ...normalized,
      requestMode: mode || config.mode,
      requestLanguageCode:
        preferredLanguageCode && preferredLanguageCode !== AUTO_LANGUAGE_CODE
          ? preferredLanguageCode
          : AUTO_LANGUAGE_CODE,
      jobId: job.job_id,
      diarizationEnabled: Boolean(withDiarization),
    };
  } catch (error) {
    throw createUpstreamSarvamError(
      error,
      config,
      "Sarvam batch transcription request failed.",
    );
  }
}

async function transcribeViaRest({
  buffer,
  filePath,
  filename,
  mimeType,
  mode,
  preferredLanguageCode,
  captureMode,
}) {
  const config = getSarvamConfig();
  const audioBuffer = buffer || fs.readFileSync(filePath);
  const attemptQueue = buildAttemptQueue({
    mode: mode || config.mode,
    preferredLanguageCode,
    captureMode,
  });

  let lastEmptyTranscriptError = null;

  for (const attempt of attemptQueue) {
    try {
      const result = await requestTranscription({
        buffer: audioBuffer,
        filename,
        mimeType,
        mode: attempt.mode,
        languageCode: attempt.languageCode,
      });

      return {
        ...result,
        requestMode: attempt.mode,
        requestLanguageCode: attempt.languageCode,
      };
    } catch (error) {
      const isRecoverableEmptyTranscript =
        error instanceof SarvamServiceError &&
        error.statusCode === 502 &&
        String(error.message || "")
          .toLowerCase()
          .includes("empty transcript");

      if (!isRecoverableEmptyTranscript) {
        throw error;
      }

      lastEmptyTranscriptError = error;
    }
  }

  if (lastEmptyTranscriptError) {
    throw lastEmptyTranscriptError;
  }

  throw new SarvamServiceError(
    "Sarvam could not detect clear speech from this recording.",
    502,
  );
}

async function transcribeAudio({
  buffer,
  filePath,
  filename = "recording.wav",
  mimeType = "audio/wav",
  mode,
  preferredLanguageCode,
  captureMode,
  durationSeconds,
  enableDiarization = false,
  numSpeakers = 2,
}) {
  const config = getSarvamConfig();
  const effectiveMode = mode || config.mode;
  const effectiveLanguageCode = normalizeLanguageCode(
    preferredLanguageCode,
    captureMode,
  );
  const effectiveDurationSeconds = getDurationSeconds({
    durationSeconds,
    filePath,
  });
  const shouldUseBatchForDiarization = Boolean(enableDiarization);
  const shouldUseBatchFirst =
    shouldUseBatchForDiarization ||
    (Number.isFinite(effectiveDurationSeconds) &&
      effectiveDurationSeconds > config.restMaxDurationSeconds);

  if (shouldUseBatchFirst) {
    return transcribeViaBatch({
      filePath,
      filename,
      mimeType,
      mode: effectiveMode,
      preferredLanguageCode: effectiveLanguageCode,
      withDiarization: enableDiarization,
      numSpeakers,
      withTimestamps: enableDiarization,
    });
  }

  try {
    return await transcribeViaRest({
      buffer,
      filePath,
      filename,
      mimeType,
      mode: effectiveMode,
      preferredLanguageCode: effectiveLanguageCode,
      captureMode,
    });
  } catch (error) {
    if (filePath && isRestDurationLimitError(error)) {
      return transcribeViaBatch({
        filePath,
        filename,
        mimeType,
        mode: effectiveMode,
        preferredLanguageCode: effectiveLanguageCode,
        withDiarization: enableDiarization,
        numSpeakers,
        withTimestamps: enableDiarization,
      });
    }

    const isEmptyTranscriptError =
      error instanceof SarvamServiceError &&
      error.statusCode === 502 &&
      String(error.message || "").toLowerCase().includes("empty transcript");

    if (filePath && isEmptyTranscriptError) {
      return transcribeViaBatch({
        filePath,
        filename,
        mimeType,
        mode: effectiveMode,
        preferredLanguageCode: effectiveLanguageCode,
        withDiarization: enableDiarization,
        numSpeakers,
        withTimestamps: enableDiarization,
      });
    }

    if (isEmptyTranscriptError) {
      throw new SarvamServiceError(
        "Sarvam could not detect clear speech from this recording. Please speak a little louder and try again.",
        502,
        error.details || null,
      );
    }

    throw error;
  }
}

module.exports = {
  AUTO_LANGUAGE_CODE,
  ENGLISH_LANGUAGE_CODE,
  SarvamServiceError,
  transcribeAudio,
};
