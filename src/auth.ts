import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { getPrismaClient } from "@/lib/prisma";

export const { auth, handlers, signIn, signOut } = NextAuth({
  session: {
    strategy: "jwt",
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID ?? "",
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google" || !user.email) {
        return false;
      }

      const prisma = getPrismaClient();

      await prisma.user.upsert({
        where: { email: user.email },
        update: {
          name: user.name ?? null,
          image: user.image ?? null,
        },
        create: {
          email: user.email,
          name: user.name ?? null,
          image: user.image ?? null,
        },
      });

      return true;
    },
    async jwt({ token, user }) {
      if (!token.email && user?.email) {
        token.email = user.email;
      }

      if (!token.email) {
        return token;
      }

      const prisma = getPrismaClient();
      const dbUser = await prisma.user.findUnique({
        where: { email: token.email },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
        },
      });

      if (!dbUser) {
        return token;
      }

      token.sub = dbUser.id;
      token.name = dbUser.name ?? token.name;
      token.picture = dbUser.image ?? token.picture;

      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }

      if (session.user && token.picture) {
        session.user.image = token.picture;
      }

      return session;
    },
  },
});
