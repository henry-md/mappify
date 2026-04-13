import { NextResponse } from "next/server";

import { getAppStatus } from "@/lib/app-status";

export async function GET() {
  const status = await getAppStatus();

  return NextResponse.json(
    {
      ok: status.databaseReachable,
      service: "mappify",
      ...status,
    },
    { status: status.databaseReachable ? 200 : 503 },
  );
}
