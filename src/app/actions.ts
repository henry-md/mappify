"use server";

import { redirect } from "next/navigation";

import { parseDraftFromImage } from "@/lib/map-parser";
import { saveDraft, saveUploadedImage } from "@/lib/map-draft-store";
import type { GeometryPreference, MapDraft } from "@/lib/map-draft-types";

function getTitleFromFileName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Untitled draft";
}

export async function createDraftAction(formData: FormData) {
  const titleValue = formData.get("title");
  const preferenceValue = formData.get("geometryPreference");
  const fileValue = formData.get("image");

  if (!(fileValue instanceof File) || fileValue.size === 0) {
    throw new Error("Please upload an image to create a draft.");
  }

  if (!fileValue.type.startsWith("image/")) {
    throw new Error("Please upload a PNG, JPEG, or another image file.");
  }

  const geometryPreference = (
    preferenceValue === "points" || preferenceValue === "regions"
      ? preferenceValue
      : "auto"
  ) satisfies GeometryPreference;

  const draftId = crypto.randomUUID();
  const title =
    typeof titleValue === "string" && titleValue.trim()
      ? titleValue.trim()
      : getTitleFromFileName(fileValue.name);

  const { asset, buffer, dataUrl } = await saveUploadedImage(draftId, fileValue);
  const parsed = await parseDraftFromImage({
    buffer,
    dataUrl,
    title,
    geometryPreference,
  });

  const draft: MapDraft = {
    id: draftId,
    title,
    createdAt: new Date().toISOString(),
    status: parsed.payload.warnings.length > 0 ? "needs_attention" : "parsed",
    image: asset,
    parsing: {
      provider: parsed.provider,
      model: parsed.model,
      diagramKind: parsed.payload.diagramKind,
      recommendedInteraction: parsed.payload.recommendedInteraction,
      geometryPreference,
      summary: parsed.payload.summary,
      warnings: parsed.payload.warnings,
    },
    territories: parsed.payload.territories,
  };

  await saveDraft(draft);
  redirect(`/drafts/${draftId}`);
}
