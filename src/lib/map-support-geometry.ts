import sharp from "sharp";

import type {
  AnchorDerivationMethod,
  DiagramKind,
  GeometryPreference,
  NormalizedBox,
  NormalizedPoint,
  PolygonRegion,
  TerritoryGeometryMode,
} from "@/lib/map-draft-types";

type Color = {
  r: number;
  g: number;
  b: number;
  a: number;
};

export type LoadedRasterImage = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  background: Color;
};

export type GeometryTarget = {
  label: string;
  labelBox: NormalizedBox | null;
  geometryModeHint: TerritoryGeometryMode;
};

type PixelPoint = {
  x: number;
  y: number;
};

type PixelBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type RegionResult = {
  anchor: NormalizedPoint;
  supportPolygons: PolygonRegion[];
  visiblePolygons: PolygonRegion[];
  seedPoint: NormalizedPoint | null;
  derivation: AnchorDerivationMethod;
  matchScore: number | null;
  confidenceDelta: number;
  notes: string[];
};

type ComponentCandidate = {
  componentId: number;
  score: number;
};

type SegmentedComponent = {
  id: number;
  area: number;
  bboxArea: number;
  bounds: PixelBox;
  centroid: { x: number; y: number };
  anchor: NormalizedPoint;
  polygons: PolygonRegion[];
  normalizedArea: number;
  usable: boolean;
};

const MIN_COMPONENT_AREA = 80;
const MIN_VISIBLE_POLYGON_AREA_RATIO = 0.003;
const MIN_ANCHOR_MATCH_SCORE = 4.5;
const MIN_VISIBLE_POLYGON_MATCH_SCORE = 7;
const BOX_PAINT_PADDING = 2;
const TEXT_DILATION_RADIUS = 1;
const REGION_NEIGHBOR_COLOR_THRESHOLD = 72;
const REGION_SEED_COLOR_THRESHOLD = 56;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function normalizePoint(point: NormalizedPoint): NormalizedPoint {
  return {
    x: clamp01(point.x),
    y: clamp01(point.y),
  };
}

function normalizeBox(box: NormalizedBox | null | undefined) {
  if (!box) {
    return null;
  }

  const left = clamp01(Math.min(box.left, box.right));
  const right = clamp01(Math.max(box.left, box.right));
  const top = clamp01(Math.min(box.top, box.bottom));
  const bottom = clamp01(Math.max(box.top, box.bottom));

  if (right - left < 0.001 || bottom - top < 0.001) {
    return null;
  }

  return { left, top, right, bottom };
}

function boxCenter(box: NormalizedBox): NormalizedPoint {
  return {
    x: (box.left + box.right) / 2,
    y: (box.top + box.bottom) / 2,
  };
}

function denormalizePoint(point: NormalizedPoint, width: number, height: number): PixelPoint {
  return {
    x: Math.max(0, Math.min(width - 1, Math.round(point.x * (width - 1)))),
    y: Math.max(0, Math.min(height - 1, Math.round(point.y * (height - 1)))),
  };
}

function denormalizeBox(box: NormalizedBox, width: number, height: number): PixelBox {
  return {
    left: Math.max(0, Math.min(width - 1, Math.floor(box.left * width))),
    top: Math.max(0, Math.min(height - 1, Math.floor(box.top * height))),
    right: Math.max(0, Math.min(width - 1, Math.ceil(box.right * width))),
    bottom: Math.max(0, Math.min(height - 1, Math.ceil(box.bottom * height))),
  };
}

function toNormalizedPoint(point: PixelPoint, width: number, height: number): NormalizedPoint {
  return normalizePoint({
    x: (point.x + 0.5) / width,
    y: (point.y + 0.5) / height,
  });
}

function pixelIndex(width: number, x: number, y: number) {
  return (y * width + x) * 4;
}

function getColorFromPixels(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): Color {
  const index = pixelIndex(width, x, y);

  return {
    r: pixels[index],
    g: pixels[index + 1],
    b: pixels[index + 2],
    a: pixels[index + 3],
  };
}

function getColor(image: LoadedRasterImage, x: number, y: number): Color {
  return getColorFromPixels(image.pixels, image.width, x, y);
}

function setColor(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  color: Color,
) {
  const index = pixelIndex(width, x, y);
  pixels[index] = color.r;
  pixels[index + 1] = color.g;
  pixels[index + 2] = color.b;
  pixels[index + 3] = color.a;
}

function colorDistance(a: Color, b: Color) {
  return Math.sqrt(
    (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2,
  );
}

function luminance(color: Color) {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

function saturation(color: Color) {
  const max = Math.max(color.r, color.g, color.b) / 255;
  const min = Math.min(color.r, color.g, color.b) / 255;

  if (max === 0) {
    return 0;
  }

  return (max - min) / max;
}

function quantizeColor(color: Color, bucket = 16) {
  return `${Math.round(color.r / bucket)}:${Math.round(color.g / bucket)}:${Math.round(color.b / bucket)}`;
}

function isNearBackground(color: Color, background: Color) {
  return colorDistance(color, background) < 20;
}

function isLikelyTextPixel(color: Color, background: Color) {
  return (
    luminance(color) < 90 &&
    saturation(color) < 0.3 &&
    colorDistance(color, background) > 25
  );
}

function isLikelyBarrierPixel(color: Color, background: Color) {
  return (
    color.a > 0 &&
    !isNearBackground(color, background) &&
    luminance(color) < 165 &&
    saturation(color) < 0.45
  );
}

export async function loadRasterImage(buffer: Buffer): Promise<LoadedRasterImage> {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8ClampedArray(data);
  const samples = new Map<string, { count: number; color: Color }>();
  const stepX = Math.max(1, Math.floor(info.width / 40));
  const stepY = Math.max(1, Math.floor(info.height / 40));

  const pushSample = (x: number, y: number) => {
    const color = {
      r: pixels[(y * info.width + x) * 4],
      g: pixels[(y * info.width + x) * 4 + 1],
      b: pixels[(y * info.width + x) * 4 + 2],
      a: pixels[(y * info.width + x) * 4 + 3],
    };

    const key = quantizeColor(color);
    const entry = samples.get(key);

    if (entry) {
      entry.count += 1;
    } else {
      samples.set(key, { count: 1, color });
    }
  };

  for (let x = 0; x < info.width; x += stepX) {
    pushSample(x, 0);
    pushSample(x, info.height - 1);
  }

  for (let y = 0; y < info.height; y += stepY) {
    pushSample(0, y);
    pushSample(info.width - 1, y);
  }

  const background =
    [...samples.values()].sort((a, b) => b.count - a.count)[0]?.color ??
    { r: 255, g: 255, b: 255, a: 255 };

  return {
    width: info.width,
    height: info.height,
    pixels,
    background,
  };
}

function expandPixelBox(
  box: PixelBox,
  width: number,
  height: number,
  paddingX: number,
  paddingY = paddingX,
): PixelBox {
  return {
    left: Math.max(0, box.left - paddingX),
    top: Math.max(0, box.top - paddingY),
    right: Math.min(width - 1, box.right + paddingX),
    bottom: Math.min(height - 1, box.bottom + paddingY),
  };
}

function pixelBoxArea(box: PixelBox) {
  return Math.max(1, box.right - box.left + 1) * Math.max(1, box.bottom - box.top + 1);
}

function dominantColorInBox(
  image: LoadedRasterImage,
  box: PixelBox,
  predicate: (color: Color) => boolean,
): Color | null {
  const samples = new Map<string, { count: number; color: Color }>();

  for (let y = box.top; y <= box.bottom; y += 1) {
    for (let x = box.left; x <= box.right; x += 1) {
      const color = getColor(image, x, y);

      if (!predicate(color)) {
        continue;
      }

      const key = quantizeColor(color, 12);
      const entry = samples.get(key);

      if (entry) {
        entry.count += 1;
      } else {
        samples.set(key, { count: 1, color });
      }
    }
  }

  return [...samples.values()].sort((a, b) => b.count - a.count)[0]?.color ?? null;
}

// Estimate the territory fill around a rendered label so we can repaint the text pixels back
// into the surrounding region before segmentation runs.
function estimateFillColorAroundLabel(
  image: LoadedRasterImage,
  box: PixelBox,
): Color | null {
  const ring = expandPixelBox(
    box,
    image.width,
    image.height,
    Math.max(4, Math.round((box.right - box.left) * 0.2)),
    Math.max(4, Math.round((box.bottom - box.top) * 0.2)),
  );

  const ringSamples = new Map<string, { count: number; color: Color }>();

  for (let y = ring.top; y <= ring.bottom; y += 1) {
    for (let x = ring.left; x <= ring.right; x += 1) {
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
        continue;
      }

      const color = getColor(image, x, y);

      if (
        color.a === 0 ||
        isNearBackground(color, image.background) ||
        isLikelyBarrierPixel(color, image.background) ||
        isLikelyTextPixel(color, image.background)
      ) {
        continue;
      }

      const key = quantizeColor(color, 12);
      const entry = ringSamples.get(key);

      if (entry) {
        entry.count += 1;
      } else {
        ringSamples.set(key, { count: 1, color });
      }
    }
  }

  const bestRing = [...ringSamples.values()].sort((a, b) => b.count - a.count)[0]?.color;

  if (bestRing) {
    return bestRing;
  }

  return dominantColorInBox(
    image,
    box,
    (color) =>
      color.a > 0 &&
      !isNearBackground(color, image.background) &&
      !isLikelyBarrierPixel(color, image.background),
  );
}

function dilateMask(mask: Uint8Array, width: number, height: number, radius: number) {
  if (radius <= 0) {
    return mask;
  }

  const dilated = new Uint8Array(mask.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) {
        continue;
      }

      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;

          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue;
          }

          dilated[ny * width + nx] = 1;
        }
      }
    }
  }

  return dilated;
}

// Erase label glyphs by repainting detected text pixels with the surrounding fill color so the
// later region pass sees continuous territory interiors instead of a maze of letters.
function eraseLabelText(
  image: LoadedRasterImage,
  labelBoxes: NormalizedBox[],
): { sanitizedPixels: Uint8ClampedArray; textMask: Uint8Array } {
  const sanitizedPixels = new Uint8ClampedArray(image.pixels);
  const textMask = new Uint8Array(image.width * image.height);

  for (const normalizedBox of labelBoxes) {
    const box = denormalizeBox(normalizedBox, image.width, image.height);
    const fillColor = estimateFillColorAroundLabel(image, box);

    if (!fillColor) {
      continue;
    }

    const paintBox = expandPixelBox(
      box,
      image.width,
      image.height,
      BOX_PAINT_PADDING,
      BOX_PAINT_PADDING,
    );
    const localWidth = paintBox.right - paintBox.left + 1;
    const localHeight = paintBox.bottom - paintBox.top + 1;
    let localMask = new Uint8Array(localWidth * localHeight);
    let accepted = false;

    for (const threshold of [26, 36, 48]) {
      localMask = new Uint8Array(localWidth * localHeight);
      let candidateCount = 0;
      let nonBackgroundCount = 0;

      for (let y = box.top; y <= box.bottom; y += 1) {
        for (let x = box.left; x <= box.right; x += 1) {
          const color = getColor(image, x, y);

          if (color.a === 0 || isNearBackground(color, image.background)) {
            continue;
          }

          nonBackgroundCount += 1;

          const isOutlier = colorDistance(color, fillColor) > threshold;

          if (!isOutlier && !isLikelyTextPixel(color, image.background)) {
            continue;
          }

          localMask[(y - paintBox.top) * localWidth + (x - paintBox.left)] = 1;
          candidateCount += 1;
        }
      }

      if (
        candidateCount > 0 &&
        candidateCount <= Math.max(1, Math.round(nonBackgroundCount * 0.85))
      ) {
        accepted = true;
        break;
      }
    }

    if (!accepted) {
      for (let y = box.top; y <= box.bottom; y += 1) {
        for (let x = box.left; x <= box.right; x += 1) {
          const color = getColor(image, x, y);

          if (!isLikelyTextPixel(color, image.background)) {
            continue;
          }

          localMask[(y - paintBox.top) * localWidth + (x - paintBox.left)] = 1;
          accepted = true;
        }
      }
    }

    if (!accepted) {
      continue;
    }

    const expandedMask = dilateMask(localMask, localWidth, localHeight, TEXT_DILATION_RADIUS);

    for (let y = 0; y < localHeight; y += 1) {
      for (let x = 0; x < localWidth; x += 1) {
        if (!expandedMask[y * localWidth + x]) {
          continue;
        }

        const globalX = paintBox.left + x;
        const globalY = paintBox.top + y;
        textMask[globalY * image.width + globalX] = 1;
        setColor(sanitizedPixels, image.width, globalX, globalY, fillColor);
      }
    }
  }

  return { sanitizedPixels, textMask };
}

function isSegmentablePixel(
  originalColor: Color,
  sanitizedColor: Color,
  background: Color,
  maskedText: boolean,
) {
  return (
    sanitizedColor.a > 0 &&
    !isNearBackground(sanitizedColor, background) &&
    (maskedText || !isLikelyBarrierPixel(originalColor, background))
  );
}

function countMaskPixels(mask: Uint8Array) {
  let count = 0;

  for (const value of mask) {
    count += value;
  }

  return count;
}

function closeMask(mask: Uint8Array, width: number, height: number) {
  const dilated = new Uint8Array(mask.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let on = 0;

      for (let dy = -1; dy <= 1 && !on; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;

          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue;
          }

          if (mask[ny * width + nx]) {
            on = 1;
            break;
          }
        }
      }

      dilated[y * width + x] = on;
    }
  }

  const eroded = new Uint8Array(mask.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let on = 1;

      for (let dy = -1; dy <= 1 && on; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;

          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            on = 0;
            break;
          }

          if (!dilated[ny * width + nx]) {
            on = 0;
            break;
          }
        }
      }

      eroded[y * width + x] = on;
    }
  }

  return eroded;
}

// Find the most interior pixel in a region mask so anchors land inside the territory even for
// long or concave polygons where a plain centroid would often drift onto the edge or outside.
function findVisualCenter(
  mask: Uint8Array,
  width: number,
  height: number,
  target: PixelPoint,
): PixelPoint | null {
  const distance = new Int16Array(mask.length);
  distance.fill(-1);
  const queue: PixelPoint[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const key = y * width + x;

      if (!mask[key]) {
        continue;
      }

      const isBoundary =
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1 ||
        !mask[key - 1] ||
        !mask[key + 1] ||
        !mask[key - width] ||
        !mask[key + width];

      if (isBoundary) {
        distance[key] = 0;
        queue.push({ x, y });
      }
    }
  }

  let cursor = 0;

  while (cursor < queue.length) {
    const point = queue[cursor++];
    const key = point.y * width + point.x;
    const nextDistance = distance[key] + 1;

    const neighbors = [
      { x: point.x - 1, y: point.y },
      { x: point.x + 1, y: point.y },
      { x: point.x, y: point.y - 1 },
      { x: point.x, y: point.y + 1 },
      { x: point.x - 1, y: point.y - 1 },
      { x: point.x + 1, y: point.y - 1 },
      { x: point.x - 1, y: point.y + 1 },
      { x: point.x + 1, y: point.y + 1 },
    ];

    for (const neighbor of neighbors) {
      if (
        neighbor.x < 0 ||
        neighbor.y < 0 ||
        neighbor.x >= width ||
        neighbor.y >= height
      ) {
        continue;
      }

      const neighborKey = neighbor.y * width + neighbor.x;

      if (!mask[neighborKey] || distance[neighborKey] !== -1) {
        continue;
      }

      distance[neighborKey] = nextDistance;
      queue.push(neighbor);
    }
  }

  let bestPoint: PixelPoint | null = null;
  let bestDistance = -1;
  let bestTargetDistance = Infinity;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const key = y * width + x;

      if (!mask[key] || distance[key] < 0) {
        continue;
      }

      const targetDistance = Math.hypot(x - target.x, y - target.y);

      if (
        distance[key] > bestDistance ||
        (distance[key] === bestDistance && targetDistance < bestTargetDistance)
      ) {
        bestDistance = distance[key];
        bestTargetDistance = targetDistance;
        bestPoint = { x, y };
      }
    }
  }

  return bestPoint;
}

function isMaskFilled(mask: Uint8Array, width: number, x: number, y: number) {
  if (x < 0 || y < 0 || x >= width) {
    return false;
  }

  return !!mask[y * width + x];
}

function simplifyLoop(points: PixelPoint[]) {
  if (points.length < 4) {
    return points;
  }

  const withoutDuplicates: PixelPoint[] = [];

  for (const point of points) {
    const last = withoutDuplicates[withoutDuplicates.length - 1];

    if (!last || last.x !== point.x || last.y !== point.y) {
      withoutDuplicates.push(point);
    }
  }

  const simplified: PixelPoint[] = [];

  for (let index = 0; index < withoutDuplicates.length; index += 1) {
    const previous =
      withoutDuplicates[(index - 1 + withoutDuplicates.length) % withoutDuplicates.length];
    const current = withoutDuplicates[index];
    const next = withoutDuplicates[(index + 1) % withoutDuplicates.length];

    const isCollinear =
      (current.x - previous.x) * (next.y - current.y) ===
      (current.y - previous.y) * (next.x - current.x);

    if (!isCollinear) {
      simplified.push(current);
    }
  }

  return simplified.length >= 3 ? simplified : withoutDuplicates;
}

function maskToPolygons(
  mask: Uint8Array,
  width: number,
  height: number,
  options: {
    offsetX: number;
    offsetY: number;
    fullWidth: number;
    fullHeight: number;
  },
): PolygonRegion[] {
  const adjacency = new Map<string, string[]>();

  const addEdge = (start: PixelPoint, end: PixelPoint) => {
    const key = `${start.x},${start.y}`;
    const value = `${end.x},${end.y}`;
    const existing = adjacency.get(key);

    if (existing) {
      existing.push(value);
    } else {
      adjacency.set(key, [value]);
    }
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) {
        continue;
      }

      if (!isMaskFilled(mask, width, x, y - 1)) {
        addEdge({ x, y }, { x: x + 1, y });
      }
      if (!isMaskFilled(mask, width, x + 1, y)) {
        addEdge({ x: x + 1, y }, { x: x + 1, y: y + 1 });
      }
      if (!isMaskFilled(mask, width, x, y + 1)) {
        addEdge({ x: x + 1, y: y + 1 }, { x, y: y + 1 });
      }
      if (!isMaskFilled(mask, width, x - 1, y)) {
        addEdge({ x, y: y + 1 }, { x, y });
      }
    }
  }

  const loops: PolygonRegion[] = [];

  while (adjacency.size > 0) {
    const [startKey] = adjacency.entries().next().value as [string, string[]];
    const [startX, startY] = startKey.split(",").map(Number);
    const points: PixelPoint[] = [{ x: startX, y: startY }];
    let currentKey = startKey;

    while (true) {
      const currentEdges = adjacency.get(currentKey);

      if (!currentEdges || currentEdges.length === 0) {
        adjacency.delete(currentKey);
        break;
      }

      const nextKey = currentEdges.shift()!;

      if (currentEdges.length === 0) {
        adjacency.delete(currentKey);
      }

      const [x, y] = nextKey.split(",").map(Number);
      points.push({ x, y });
      currentKey = nextKey;

      if (currentKey === startKey) {
        break;
      }
    }

    const simplified = simplifyLoop(points);

    if (simplified.length < 3) {
      continue;
    }

    const outer = simplified.map((point) =>
      normalizePoint({
        x: (point.x + options.offsetX) / options.fullWidth,
        y: (point.y + options.offsetY) / options.fullHeight,
      }),
    );

    const first = outer[0];
    const last = outer[outer.length - 1];

    if (Math.abs(first.x - last.x) > 0.0001 || Math.abs(first.y - last.y) > 0.0001) {
      outer.push(first);
    }

    loops.push({ outer, holes: [] });
  }

  return loops;
}

function geometryArea(polygons: PolygonRegion[]) {
  return polygons.reduce((total, polygon) => {
    let area = 0;

    for (let index = 0; index < polygon.outer.length - 1; index += 1) {
      const current = polygon.outer[index];
      const next = polygon.outer[index + 1];
      area += current.x * next.y - next.x * current.y;
    }

    return total + Math.abs(area / 2);
  }, 0);
}

function extractComponentMask(
  componentId: number,
  componentLabels: Int32Array,
  imageWidth: number,
  bounds: PixelBox,
) {
  const localWidth = bounds.right - bounds.left + 1;
  const localHeight = bounds.bottom - bounds.top + 1;
  const localMask = new Uint8Array(localWidth * localHeight);

  for (let y = bounds.top; y <= bounds.bottom; y += 1) {
    for (let x = bounds.left; x <= bounds.right; x += 1) {
      if (componentLabels[y * imageWidth + x] !== componentId) {
        continue;
      }

      localMask[(y - bounds.top) * localWidth + (x - bounds.left)] = 1;
    }
  }

  return { localMask, localWidth, localHeight };
}

// Segment the full image into region candidates before any label assignment happens. This keeps
// polygon discovery global and lets labels attach to existing regions instead of inventing them.
function segmentImage(
  image: LoadedRasterImage,
  sanitizedPixels: Uint8ClampedArray,
  textMask: Uint8Array,
): { componentLabels: Int32Array; components: SegmentedComponent[] } {
  const componentLabels = new Int32Array(image.width * image.height);
  componentLabels.fill(-1);
  const components: SegmentedComponent[] = [];
  const neighbors = [
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
    { x: 0, y: 1 },
  ];

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const startKey = y * image.width + x;

      if (componentLabels[startKey] !== -1) {
        continue;
      }

      const originalColor = getColor(image, x, y);
      const sanitizedColor = getColorFromPixels(sanitizedPixels, image.width, x, y);

      if (
        !isSegmentablePixel(
          originalColor,
          sanitizedColor,
          image.background,
          !!textMask[startKey],
        )
      ) {
        continue;
      }

      const componentId = components.length;
      const queue: PixelPoint[] = [{ x, y }];
      componentLabels[startKey] = componentId;
      const seedColor = sanitizedColor;
      let cursor = 0;
      let area = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let sumX = 0;
      let sumY = 0;

      while (cursor < queue.length) {
        const point = queue[cursor++];
        const currentColor = getColorFromPixels(
          sanitizedPixels,
          image.width,
          point.x,
          point.y,
        );

        area += 1;
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
        sumX += point.x;
        sumY += point.y;

        for (const neighbor of neighbors) {
          const nx = point.x + neighbor.x;
          const ny = point.y + neighbor.y;

          if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) {
            continue;
          }

          const neighborKey = ny * image.width + nx;

          if (componentLabels[neighborKey] !== -1) {
            continue;
          }

          const neighborOriginal = getColor(image, nx, ny);
          const neighborColor = getColorFromPixels(sanitizedPixels, image.width, nx, ny);

          if (
            !isSegmentablePixel(
              neighborOriginal,
              neighborColor,
              image.background,
              !!textMask[neighborKey],
            )
          ) {
            continue;
          }

          if (
            colorDistance(neighborColor, currentColor) > REGION_NEIGHBOR_COLOR_THRESHOLD &&
            colorDistance(neighborColor, seedColor) > REGION_SEED_COLOR_THRESHOLD
          ) {
            continue;
          }

          componentLabels[neighborKey] = componentId;
          queue.push({ x: nx, y: ny });
        }
      }

      const bounds = { left: minX, top: minY, right: maxX, bottom: maxY };
      const bboxArea = pixelBoxArea(bounds);
      const usable = area >= MIN_COMPONENT_AREA;

      if (!usable) {
        components.push({
          id: componentId,
          area,
          bboxArea,
          bounds,
          centroid: {
            x: sumX / Math.max(1, area),
            y: sumY / Math.max(1, area),
          },
          anchor: { x: 0.5, y: 0.5 },
          polygons: [],
          normalizedArea: 0,
          usable: false,
        });
        continue;
      }

      const { localMask, localWidth, localHeight } = extractComponentMask(
        componentId,
        componentLabels,
        image.width,
        bounds,
      );
      const closedMask = closeMask(localMask, localWidth, localHeight);
      const closedArea = countMaskPixels(closedMask);
      const activeMask =
        closedArea >= Math.round(area * 0.6) && closedArea > 0 ? closedMask : localMask;
      const target = {
        x: Math.round(sumX / area) - bounds.left,
        y: Math.round(sumY / area) - bounds.top,
      };
      const center =
        findVisualCenter(activeMask, localWidth, localHeight, target) ??
        findVisualCenter(localMask, localWidth, localHeight, target) ??
        {
          x: Math.max(0, Math.min(localWidth - 1, target.x)),
          y: Math.max(0, Math.min(localHeight - 1, target.y)),
        };
      const polygons = maskToPolygons(activeMask, localWidth, localHeight, {
        offsetX: bounds.left,
        offsetY: bounds.top,
        fullWidth: image.width,
        fullHeight: image.height,
      })
        .filter((polygon) => geometryArea([polygon]) > 0.0002)
        .sort((a, b) => geometryArea([b]) - geometryArea([a]));
      const normalizedArea = geometryArea(polygons);

      components.push({
        id: componentId,
        area,
        bboxArea,
        bounds,
        centroid: {
          x: sumX / area,
          y: sumY / area,
        },
        anchor: toNormalizedPoint(
          { x: bounds.left + center.x, y: bounds.top + center.y },
          image.width,
          image.height,
        ),
        polygons,
        normalizedArea,
        usable: polygons.length > 0,
      });
    }
  }

  return { componentLabels, components };
}

function accumulateComponentCounts(
  componentLabels: Int32Array,
  components: SegmentedComponent[],
  width: number,
  box: PixelBox,
) {
  const counts = new Map<number, number>();

  for (let y = box.top; y <= box.bottom; y += 1) {
    for (let x = box.left; x <= box.right; x += 1) {
      const componentId = componentLabels[y * width + x];

      if (componentId < 0 || !components[componentId]?.usable) {
        continue;
      }

      counts.set(componentId, (counts.get(componentId) ?? 0) + 1);
    }
  }

  return counts;
}

function fallbackRegionResult(box: NormalizedBox | null, note: string): RegionResult {
  const anchor = box ? boxCenter(box) : { x: 0.5, y: 0.5 };

  return {
    anchor,
    supportPolygons: [],
    visiblePolygons: [],
    seedPoint: null,
    derivation: box ? "label-box-center" : "canvas-center",
    matchScore: null,
    confidenceDelta: box ? -0.15 : -0.35,
    notes: [note],
  };
}

function scoreComponentCandidates(
  target: GeometryTarget,
  image: LoadedRasterImage,
  componentLabels: Int32Array,
  components: SegmentedComponent[],
): ComponentCandidate[] {
  const normalizedBox = normalizeBox(target.labelBox);

  if (!normalizedBox) {
    return [];
  }

  const innerBox = denormalizeBox(normalizedBox, image.width, image.height);
  const outerBox = expandPixelBox(
    innerBox,
    image.width,
    image.height,
    Math.max(6, Math.round((innerBox.right - innerBox.left) * 0.25)),
    Math.max(6, Math.round((innerBox.bottom - innerBox.top) * 0.35)),
  );
  const innerCounts = accumulateComponentCounts(
    componentLabels,
    components,
    image.width,
    innerBox,
  );
  const outerCounts = accumulateComponentCounts(
    componentLabels,
    components,
    image.width,
    outerBox,
  );
  const labelCenter = denormalizePoint(boxCenter(normalizedBox), image.width, image.height);
  const candidates = new Map<number, ComponentCandidate>();

  for (const [componentId, outerCount] of outerCounts.entries()) {
    const component = components[componentId];

    if (!component?.usable) {
      continue;
    }

    const innerCount = innerCounts.get(componentId) ?? 0;
    const innerCoverage = innerCount / pixelBoxArea(innerBox);
    const componentCoverage = outerCount / Math.max(1, component.area);
    const bboxCoverage = outerCount / Math.max(1, component.bboxArea);
    const distance = Math.hypot(
      component.centroid.x - labelCenter.x,
      component.centroid.y - labelCenter.y,
    );
    const distancePenalty =
      distance /
      Math.max(18, Math.max(innerBox.right - innerBox.left, innerBox.bottom - innerBox.top));
    const score =
      componentCoverage * 120 +
      bboxCoverage * 80 +
      innerCoverage * 2 -
      distancePenalty * 1.5;

    candidates.set(componentId, { componentId, score });
  }

  return [...candidates.values()].sort((a, b) => b.score - a.score);
}

function assignTargetsToComponents(
  targets: GeometryTarget[],
  image: LoadedRasterImage,
  componentLabels: Int32Array,
  components: SegmentedComponent[],
) {
  const candidateLists = targets.map((target) =>
    scoreComponentCandidates(target, image, componentLabels, components),
  );
  const assignments = new Array<number | null>(targets.length).fill(null);
  const assignmentScores = new Array<number>(targets.length).fill(-Infinity);
  const taken = new Set<number>();
  const order = candidateLists
    .map((candidates, index) => ({
      index,
      best: candidates[0]?.score ?? -Infinity,
      margin: (candidates[0]?.score ?? -Infinity) - (candidates[1]?.score ?? -Infinity),
    }))
    .sort((a, b) => b.best - a.best || b.margin - a.margin);

  for (const item of order) {
    for (const candidate of candidateLists[item.index]) {
      if (taken.has(candidate.componentId) || candidate.score < MIN_ANCHOR_MATCH_SCORE) {
        continue;
      }

      assignments[item.index] = candidate.componentId;
      assignmentScores[item.index] = candidate.score;
      taken.add(candidate.componentId);
      break;
    }
  }

  return { assignments, assignmentScores };
}

export async function deriveGeometryFromImage({
  image,
  buffer,
  targets,
  geometryPreference,
  diagramKind,
}: {
  image?: LoadedRasterImage;
  buffer: Buffer;
  targets: GeometryTarget[];
  geometryPreference: GeometryPreference;
  diagramKind: DiagramKind;
}): Promise<RegionResult[]> {
  const raster = image ?? (await loadRasterImage(buffer));
  const labelBoxes = targets
    .map((target) => normalizeBox(target.labelBox))
    .filter((box): box is NormalizedBox => !!box);
  const { sanitizedPixels, textMask } = eraseLabelText(raster, labelBoxes);
  const { componentLabels, components } = segmentImage(raster, sanitizedPixels, textMask);
  const { assignments, assignmentScores } = assignTargetsToComponents(
    targets,
    raster,
    componentLabels,
    components,
  );

  return targets.map((target, index) => {
    const normalizedBox = normalizeBox(target.labelBox);
    const componentId = assignments[index];
    const matchScore = assignmentScores[index];

    if (componentId === null || componentId === undefined || matchScore < MIN_ANCHOR_MATCH_SCORE) {
      return fallbackRegionResult(
        normalizedBox,
        "No trustworthy segmented region matched this label, so the point fell back to the label center.",
      );
    }

    const component = components[componentId];

    if (!component || !component.usable) {
      return fallbackRegionResult(
        normalizedBox,
        "The matched region was not stable enough to keep, so the point fell back to the label center.",
      );
    }

    const allowVisiblePolygons =
      geometryPreference !== "points" &&
      target.geometryModeHint !== "point" &&
      diagramKind !== "medical" &&
      component.normalizedArea >= MIN_VISIBLE_POLYGON_AREA_RATIO &&
      matchScore >= MIN_VISIBLE_POLYGON_MATCH_SCORE;
    const notes = [
      "Anchor derived from the visual center of a region segmented from the full image after masking label text.",
    ];

    if (!allowVisiblePolygons && component.polygons.length > 0) {
      notes.push(
        "Region segmentation was strong enough to place an anchor, but visible outlines were withheld for this draft.",
      );
    }

    return {
      anchor: component.anchor,
      supportPolygons: component.polygons,
      visiblePolygons: allowVisiblePolygons ? component.polygons : [],
      seedPoint: null,
      derivation: "segmented-region-center",
      matchScore,
      confidenceDelta: allowVisiblePolygons ? 0.22 : 0.1,
      notes,
    } satisfies RegionResult;
  });
}
