import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { imageSize } from "image-size";

import type {
  DraftDebugArtifacts,
  GeometryStrategy,
  ImageAsset,
  MapDraft,
  TerritoryDraft,
} from "@/lib/map-draft-types";

const rootStorageDir = path.join(process.cwd(), ".mappify");
const draftsDir = path.join(rootStorageDir, "drafts");
const uploadsDir = path.join(process.cwd(), "public", "uploads");

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

function sanitizeFileStem(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "upload";
}

function getExtension(fileName: string, mimeType: string) {
  const extFromName = path.extname(fileName);

  if (extFromName) {
    return extFromName.toLowerCase();
  }

  if (mimeType === "image/png") {
    return ".png";
  }

  if (mimeType === "image/jpeg") {
    return ".jpg";
  }

  if (mimeType === "image/webp") {
    return ".webp";
  }

  return ".bin";
}

async function saveImageAssetFromBuffer({
  filename,
  buffer,
  mimeType,
  originalFilename,
}: {
  filename: string;
  buffer: Buffer;
  mimeType: string;
  originalFilename: string;
}) {
  await ensureDir(uploadsDir);

  const absolutePath = path.join(uploadsDir, filename);
  const publicPath = `/uploads/${filename}`;
  const dimensions = imageSize(buffer);

  if (!dimensions.width || !dimensions.height) {
    throw new Error("Could not determine the image dimensions.");
  }

  await writeFile(absolutePath, buffer);

  return {
    src: publicPath,
    width: dimensions.width,
    height: dimensions.height,
    originalFilename,
    mimeType,
  } satisfies ImageAsset;
}

export async function saveUploadedImage(
  draftId: string,
  file: File,
): Promise<{ asset: ImageAsset; dataUrl: string; buffer: Buffer }> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const extension = getExtension(file.name, file.type);
  const safeStem = sanitizeFileStem(path.basename(file.name, extension));
  const filename = `${draftId}-${safeStem}${extension}`;
  const asset = await saveImageAssetFromBuffer({
    filename,
    buffer,
    mimeType: file.type || "application/octet-stream",
    originalFilename: file.name,
  });

  return {
    asset,
    buffer,
    dataUrl: `data:${file.type || "application/octet-stream"};base64,${buffer.toString("base64")}`,
  };
}

// Persist generated helper artifacts next to uploads so DEBUG_UI can render the exact
// intermediary image that downstream geometry extraction used.
export async function saveDerivedImageAsset({
  draftId,
  stem,
  buffer,
  mimeType,
  originalFilename,
}: {
  draftId: string;
  stem: string;
  buffer: Buffer;
  mimeType: string;
  originalFilename: string;
}) {
  const extension = getExtension(originalFilename, mimeType);
  const safeStem = sanitizeFileStem(path.basename(stem, extension));
  const filename = `${draftId}-${safeStem}${extension}`;

  return saveImageAssetFromBuffer({
    filename,
    buffer,
    mimeType,
    originalFilename,
  });
}

function hydrateTerritory(territory: TerritoryDraft): TerritoryDraft {
  return {
    ...territory,
    supportPolygons: territory.supportPolygons ?? territory.polygons ?? [],
    labelBox: territory.labelBox ?? null,
    seedPoint: territory.seedPoint ?? null,
    supportSeedPoints: territory.supportSeedPoints ?? [],
    anchorDerivation: territory.anchorDerivation ?? "canvas-center",
    debugRegionMatchScore: territory.debugRegionMatchScore ?? null,
  };
}

function inferStrategyFromDraft(draft: MapDraft): GeometryStrategy {
  if (draft.debug?.outlineHelperImage) {
    return "outline-generation";
  }

  if (draft.territories.some((territory) => territory.anchorDerivation === "model-vision")) {
    return "model";
  }

  if (draft.territories.some((territory) => territory.seedPoint)) {
    return "seeded";
  }

  return "segmentation";
}

function hydrateDebug(debug: DraftDebugArtifacts | undefined): DraftDebugArtifacts {
  return {
    outlineHelperImage: debug?.outlineHelperImage ?? null,
    outlineHelperPrompt: debug?.outlineHelperPrompt ?? null,
    outlineHelperModel: debug?.outlineHelperModel ?? null,
    outlineGridImage: debug?.outlineGridImage ?? null,
    gridLocalizationPrompt: debug?.gridLocalizationPrompt ?? null,
    gridLocalizationModel: debug?.gridLocalizationModel ?? null,
  };
}

function hydrateDraft(draft: MapDraft): MapDraft {
  return {
    ...draft,
    parsing: {
      ...draft.parsing,
      geometryStrategy:
        draft.parsing.geometryStrategy ?? inferStrategyFromDraft(draft),
      inferredSubject: draft.parsing.inferredSubject ?? null,
    },
    territories: draft.territories.map(hydrateTerritory),
    debug: hydrateDebug(draft.debug),
  };
}

export async function saveDraft(draft: MapDraft) {
  await ensureDir(draftsDir);
  const filePath = path.join(draftsDir, `${draft.id}.json`);
  await writeFile(filePath, JSON.stringify(draft, null, 2), "utf8");
}

export async function getDraft(draftId: string) {
  const filePath = path.join(draftsDir, `${draftId}.json`);
  const raw = await readFile(filePath, "utf8");
  return hydrateDraft(JSON.parse(raw) as MapDraft);
}

export async function listDrafts(limit = 8) {
  await ensureDir(draftsDir);

  const files = (await readdir(draftsDir))
    .filter((file) => file.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, limit);

  const drafts = await Promise.all(
    files.map(async (file) => {
      const raw = await readFile(path.join(draftsDir, file), "utf8");
      return hydrateDraft(JSON.parse(raw) as MapDraft);
    }),
  );

  return drafts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
