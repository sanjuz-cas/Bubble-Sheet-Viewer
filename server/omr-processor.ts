import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

interface OMRResult {
  detectedAnswers: string[][];
  confidence: number[];
  detectedSet?: string;
  detectedRollNumber?: string;
  rollConfidence?: number[];
  annotatedImage?: string;
}

export async function processOMRImage(
  imageBuffer: Buffer,
  totalQuestions: number,
  optionsPerQuestion: number,
  correctAnswers: string[][]
): Promise<OMRResult> {
  const tmpPath = join(tmpdir(), `bubblescan_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);

  try {
    await writeFile(tmpPath, imageBuffer);

    const scriptPath = join(process.cwd(), "server", "omr_processor.py");

    const result = await new Promise<OMRResult>((resolve, reject) => {
      const py = spawn(process.platform === "win32" ? "python" : "python3", [
        scriptPath,
        tmpPath,
        String(totalQuestions),
        String(optionsPerQuestion),
        JSON.stringify(correctAnswers || []),
      ]);

      let stdout = "";
      let stderr = "";

      py.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      py.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

      py.on("close", (code) => {
        if (stderr) {
          console.error("[OMR Python stderr]", stderr);
        }

        if (!stdout.trim()) {
          return reject(new Error("Python OMR processor returned no output"));
        }

        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed.error) {
            return reject(new Error(parsed.error));
          }
          resolve({
            detectedAnswers: parsed.detectedAnswers || [],
            confidence: parsed.confidence || [],
            detectedSet: parsed.detectedSet || "",
            detectedRollNumber: parsed.detectedRollNumber || "",
            rollConfidence: parsed.rollConfidence || [],
            annotatedImage: parsed.annotatedImage || undefined,
          });
        } catch (e) {
          reject(new Error(`Failed to parse OMR output: ${stdout.slice(0, 200)}`));
        }
      });

      py.on("error", (err) => {
        reject(new Error(`Failed to start Python process: ${err.message}`));
      });
    });

    return result;
  } finally {
    unlink(tmpPath).catch(() => {});
  }
}

export interface PDFPageImage {
  pageNumber: number;
  totalPages: number;
  width: number;
  height: number;
  dataUrl: string;
}

export async function unpackPDFBuffer(
  pdfBuffer: Buffer,
  dpi: number = 180
): Promise<{ totalPages: number; pages: PDFPageImage[] }> {
  const tmpPath = join(tmpdir(), `bubblescan_pdf_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);

  try {
    await writeFile(tmpPath, pdfBuffer);
    const scriptPath = join(process.cwd(), "server", "pdf_unpacker.py");

    return await new Promise((resolve, reject) => {
      const py = spawn(process.platform === "win32" ? "python" : "python3", [
        scriptPath,
        tmpPath
      ]);

      let stdout = "";
      let stderr = "";

      py.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      py.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

      py.on("close", (code) => {
        if (stderr) console.error("[PDF Unpacker stderr]", stderr);
        if (!stdout.trim()) return reject(new Error("Python PDF unpacker returned no output"));
        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed.error) return reject(new Error(parsed.error));
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse PDF output: ${stdout.slice(0, 200)}`));
        }
      });

      py.on("error", (err) => reject(new Error(`Failed to start PDF Python unpacker: ${err.message}`)));
    });
  } finally {
    unlink(tmpPath).catch(() => {});
  }
}
