import { getPrismaClient } from "@/lib/prisma";

type AppStatus = {
  databaseUrlConfigured: boolean;
  databaseReachable: boolean;
  userCount: number | null;
  projectCount: number | null;
  error: string | null;
};

export async function getAppStatus(): Promise<AppStatus> {
  if (!process.env.DATABASE_URL) {
    return {
      databaseUrlConfigured: false,
      databaseReachable: false,
      userCount: null,
      projectCount: null,
      error: "Set DATABASE_URL to connect Prisma to Postgres.",
    };
  }

  try {
    const prisma = getPrismaClient();
    const [userCount, projectCount] = await Promise.all([
      prisma.user.count(),
      prisma.project.count(),
    ]);

    return {
      databaseUrlConfigured: true,
      databaseReachable: true,
      userCount,
      projectCount,
      error: null,
    };
  } catch (error) {
    return {
      databaseUrlConfigured: true,
      databaseReachable: false,
      userCount: null,
      projectCount: null,
      error: error instanceof Error ? error.message : "Unknown database error.",
    };
  }
}
