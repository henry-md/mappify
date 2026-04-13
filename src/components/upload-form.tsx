"use client";

import { useFormStatus } from "react-dom";

import { createDraftAction } from "@/app/actions";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl bg-white px-4 py-3 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Parsing image..." : "Upload and generate draft"}
    </button>
  );
}

export function UploadForm() {
  return (
    <form action={createDraftAction} className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="title" className="text-sm text-slate-300">
          Title
        </label>
        <input
          id="title"
          name="title"
          placeholder="NYC neighborhoods"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="image" className="text-sm text-slate-300">
          Image
        </label>
        <input
          id="image"
          name="image"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/jpg"
          required
          className="block w-full rounded-xl border border-dashed border-white/15 bg-white/4 px-4 py-4 text-sm text-slate-300 file:mr-4 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-black"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="geometryPreference" className="text-sm text-slate-300">
          Geometry preference
        </label>
        <select
          id="geometryPreference"
          name="geometryPreference"
          defaultValue="auto"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none"
        >
          <option value="auto">Auto</option>
          <option value="regions">Prefer outlines when they look trustworthy</option>
          <option value="points">Prefer dots only</option>
        </select>
      </div>

      <SubmitButton />
    </form>
  );
}
