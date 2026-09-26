import { z } from "zod";

import { TtsProviderConfigService } from "@karakeep/shared-server";

import { publicProcedure, router } from "../index";

export const ttsAppRouter = router({
  // Whether an admin has configured a TTS server. Live (DB-backed) rather
  // than part of the static clientConfig snapshot, since it can change at
  // runtime without a redeploy.
  isConfigured: publicProcedure
    .output(z.object({ isConfigured: z.boolean() }))
    .query(async ({ ctx }) => {
      const config = await TtsProviderConfigService.get(ctx.db);
      return { isConfigured: !!config };
    }),
});
