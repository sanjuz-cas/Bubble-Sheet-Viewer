interface OMRResult {
  detectedAnswers: string[];
  confidence: number[];
}

function getPixelBrightness(data: Buffer, x: number, y: number, width: number, channels: number): number {
  const idx = (y * width + x) * channels;
  if (channels >= 3) {
    return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }
  return data[idx];
}

function analyzeRegion(
  data: Buffer,
  startX: number,
  startY: number,
  regionWidth: number,
  regionHeight: number,
  imgWidth: number,
  channels: number
): number {
  let darkPixels = 0;
  let totalPixels = 0;
  const sampleStep = Math.max(1, Math.floor(Math.min(regionWidth, regionHeight) / 12));

  for (let y = startY; y < startY + regionHeight && y < data.length / (imgWidth * channels); y += sampleStep) {
    for (let x = startX; x < startX + regionWidth && x < imgWidth; x += sampleStep) {
      const brightness = getPixelBrightness(data, x, y, imgWidth, channels);
      if (brightness < 128) {
        darkPixels++;
      }
      totalPixels++;
    }
  }

  return totalPixels > 0 ? darkPixels / totalPixels : 0;
}

export async function processOMRImage(
  imageBuffer: Buffer,
  totalQuestions: number,
  optionsPerQuestion: number,
  correctAnswers: string[]
): Promise<OMRResult> {
  const { Jimp } = await import("jimp");

  const image = await Jimp.read(imageBuffer);
  const width = image.width;
  const height = image.height;

  image.greyscale();
  image.contrast(0.3);

  const bitmap = image.bitmap;
  const data = bitmap.data as unknown as Buffer;
  const channels = 4;

  const optionLabels = ['A', 'B', 'C', 'D', 'E'].slice(0, optionsPerQuestion);

  const marginLeft = Math.floor(width * 0.12);
  const marginRight = Math.floor(width * 0.88);
  const marginTop = Math.floor(height * 0.1);
  const marginBottom = Math.floor(height * 0.92);

  const usableWidth = marginRight - marginLeft;
  const usableHeight = marginBottom - marginTop;

  const questionsPerColumn = Math.ceil(totalQuestions / (totalQuestions > 30 ? 2 : 1));
  const columns = totalQuestions > 30 ? 2 : 1;

  const columnWidth = usableWidth / columns;
  const rowHeight = usableHeight / questionsPerColumn;

  const bubbleWidth = Math.floor((columnWidth * 0.6) / optionsPerQuestion);
  const bubbleHeight = Math.floor(rowHeight * 0.6);

  const detectedAnswers: string[] = [];
  const confidence: number[] = [];

  for (let q = 0; q < totalQuestions; q++) {
    const col = Math.floor(q / questionsPerColumn);
    const row = q % questionsPerColumn;

    const baseX = marginLeft + col * columnWidth + columnWidth * 0.3;
    const baseY = marginTop + row * rowHeight + rowHeight * 0.2;

    let maxFill = 0;
    let selectedOption = -1;
    const fills: number[] = [];

    for (let opt = 0; opt < optionsPerQuestion; opt++) {
      const optX = Math.floor(baseX + opt * bubbleWidth);
      const optY = Math.floor(baseY);

      const fillRatio = analyzeRegion(
        data,
        optX,
        optY,
        Math.floor(bubbleWidth * 0.8),
        Math.floor(bubbleHeight),
        width,
        channels
      );

      fills.push(fillRatio);

      if (fillRatio > maxFill) {
        maxFill = fillRatio;
        selectedOption = opt;
      }
    }

    const threshold = 0.35;
    if (maxFill > threshold && selectedOption >= 0) {
      const secondHighest = fills
        .filter((_, i) => i !== selectedOption)
        .reduce((max, v) => Math.max(max, v), 0);

      if (maxFill - secondHighest > 0.1) {
        detectedAnswers.push(optionLabels[selectedOption]);
        confidence.push(Math.min(1, maxFill));
      } else {
        detectedAnswers.push(optionLabels[selectedOption]);
        confidence.push(Math.min(1, maxFill * 0.7));
      }
    } else {
      detectedAnswers.push('');
      confidence.push(0);
    }
  }

  return { detectedAnswers, confidence };
}
