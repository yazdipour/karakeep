"use client";

import { useEffect, useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { ActionButton } from "@/components/ui/action-button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/lib/i18n/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Search } from "lucide-react";
import { toast } from "sonner";

import { useTRPC } from "@karakeep/shared-react/trpc";

export default function TTSProviderSettings() {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const { data: config } = useQuery(api.admin.getTtsConfig.queryOptions());

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("kokoro");
  const [voice, setVoice] = useState("");
  const [discoveredVoices, setDiscoveredVoices] = useState<string[]>([]);

  useEffect(() => {
    if (config) {
      setBaseUrl(config.baseUrl);
      setModel(config.model);
      setVoice(config.voice);
    }
  }, [config]);

  const { mutate: updateConfig, isPending: isSaving } = useMutation(
    api.admin.updateTtsConfig.mutationOptions({
      onSuccess: () => {
        toast.success("TTS settings saved");
        setApiKey("");
        queryClient.invalidateQueries(api.admin.getTtsConfig.pathFilter());
        queryClient.invalidateQueries(api.tts.isConfigured.pathFilter());
      },
      onError: (error) => {
        toast.error(`Failed to save TTS settings: ${error.message}`);
      },
    }),
  );

  const { mutate: discoverVoices, isPending: isDiscovering } = useMutation(
    api.admin.discoverTtsVoices.mutationOptions({
      onSuccess: (data) => {
        setDiscoveredVoices(data.voices);
        if (data.voices.length === 0) {
          toast.error("The server didn't return any voices");
        }
      },
      onError: (error) => {
        toast.error(`Failed to discover voices: ${error.message}`);
      },
    }),
  );

  return (
    <AdminCard className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">{t("admin.tts.tts_settings")}</h2>
        <p className="text-sm text-muted-foreground">
          Configure the OpenAI-compatible text-to-speech server used to narrate
          bookmarks.
        </p>
      </div>

      <Field orientation="horizontal" className="rounded-lg border p-3">
        <FieldContent>
          <FieldLabel htmlFor="tts-provider">Server Type</FieldLabel>
          <FieldDescription>
            Only Kokoro-compatible servers are supported right now.
          </FieldDescription>
        </FieldContent>
        <Select value="kokoro" disabled>
          <SelectTrigger id="tts-provider" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="kokoro">Kokoro</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      <Field className="rounded-lg border p-3">
        <FieldLabel htmlFor="tts-base-url">Base URL</FieldLabel>
        <FieldDescription>
          e.g. http://localhost:8880/v1 (Kokoro-FastAPI&apos;s OpenAI-compatible
          endpoint)
        </FieldDescription>
        <Input
          id="tts-base-url"
          type="url"
          placeholder="http://localhost:8880/v1"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </Field>

      <Field className="rounded-lg border p-3">
        <FieldLabel htmlFor="tts-api-key">API Key</FieldLabel>
        <FieldDescription>
          {config?.hasApiKey
            ? "A key is already set. Leave blank to keep it unchanged."
            : "Optional, only needed if your server requires one."}
        </FieldDescription>
        <Input
          id="tts-api-key"
          type="password"
          placeholder={config?.hasApiKey ? "••••••••" : ""}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </Field>

      <Field className="rounded-lg border p-3">
        <FieldLabel htmlFor="tts-model">Model</FieldLabel>
        <Input
          id="tts-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
      </Field>

      <Field className="rounded-lg border p-3">
        <FieldLabel htmlFor="tts-voice">Voice</FieldLabel>
        <FieldDescription>
          Discover the voices your server offers, or type one manually (e.g.
          af_heart).
        </FieldDescription>
        <div className="flex gap-2">
          {discoveredVoices.length > 0 ? (
            <Select value={voice} onValueChange={setVoice}>
              <SelectTrigger id="tts-voice" className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {discoveredVoices.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="tts-voice"
              className="flex-1"
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
            />
          )}
          <ActionButton
            type="button"
            variant="outline"
            loading={isDiscovering}
            disabled={!baseUrl}
            onClick={() =>
              discoverVoices({ baseUrl, apiKey: apiKey || undefined })
            }
          >
            <Search className="mr-2 size-4" />
            Discover
          </ActionButton>
        </div>
      </Field>

      <div className="flex justify-end">
        <ActionButton
          loading={isSaving}
          disabled={!baseUrl || !model || !voice}
          onClick={() =>
            updateConfig({
              provider: "kokoro",
              baseUrl,
              apiKey: apiKey || undefined,
              model,
              voice,
            })
          }
        >
          <Save className="mr-2 size-4" />
          {t("actions.save")}
        </ActionButton>
      </div>
    </AdminCard>
  );
}
