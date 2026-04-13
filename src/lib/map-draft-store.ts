import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { imageSize } from "image-size";

import type { ImageAsset, MapDraft, TerritoryDraft } from "@/lib/map-draft-types";

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

export async function saveUploadedImage(
  draftId: string,
  file: File,
): Promise<{ asset: ImageAsset; dataUrl: string; buffer: Buffer }> {
  await ensureDir(uploadsDir);

  const buffer = Buffer.from(await file.arrayBuffer());
  const dimensions = imageSize(buffer);

  if (!dimensions.width || !dimensions.height) {
    throw new Error("Could not determine the uploaded image dimensions.");
  }

  const extension = getExtension(file.name, file.type);
  const safeStem = sanitizeFileStem(path.basename(file.name, extension));
  const filename = `${draftId}-${safeStem}${extension}`;
  const absolutePath = path.join(uploadsDir, filename);
  const publicPath = `/uploads/${filename}`;

  await writeFile(absolutePath, buffer);

  return {
    asset: {
      src: publicPath,
      width: dimensions.width,
      height: dimensions.height,
      originalFilename: file.name,
      mimeType: file.type || "application/octet-stream",
    },
    buffer,
    dataUrl: `data:${file.type || "application/octet-stream"};base64,${buffer.toString("base64")}`,
  };
}

function hydrateTerritory(territory: TerritoryDraft): TerritoryDraft {
  return {
    ...territory,
    supportPolygons: territory.supportPolygons ?? territory.polygons ?? [],
    labelBox: territory.labelBox ?? null,
    seedPoint: territory.seedPoint ?? null,
    anchorDerivation: territory.anchorDerivation ?? "canvas-center",
    debugRegionMatchScore: territory.debugRegionMatchScore ?? null,
  };
}

function hydrateDraft(draft: MapDraft): MapDraft {
  return {
    ...draft,
    territories: draft.territories.map(hydrateTerritory),
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
