"use client";

import { useEffect, useState } from "react";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
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

import { SettingsPage, SettingsSection } from "./SettingsPage";

interface DiscoveredVoice {
  id: string;
  targetQuality?: string;
}

function TTSProviderSettings() {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const { data: config } = useQuery(api.tts.getSettings.queryOptions());

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [voice, setVoice] = useState("");
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [discoveredVoices, setDiscoveredVoices] = useState<DiscoveredVoice[]>(
    [],
  );

  useEffect(() => {
    if (config) {
      setBaseUrl(config.baseUrl);
      setModel(config.model);
      setVoice(config.voice);
    }
  }, [config]);

  const { mutate: updateConfig, isPending: isSaving } = useMutation(
    api.tts.updateSettings.mutationOptions({
      onSuccess: () => {
        toast.success("TTS settings saved");
        setApiKey("");
        queryClient.invalidateQueries(api.tts.getSettings.pathFilter());
        queryClient.invalidateQueries(api.tts.isConfigured.pathFilter());
      },
      onError: (error) => {
        toast.error(`Failed to save TTS settings: ${error.message}`);
      },
    }),
  );

  const { mutate: discoverModels, isPending: isDiscoveringModels } =
    useMutation(
      api.tts.discoverModels.mutationOptions({
        onSuccess: (data) => {
          setDiscoveredModels(data.models);
          if (data.models.length === 0) {
            toast.error("The server didn't return any models");
          }
        },
        onError: (error) => {
          toast.error(`Failed to discover models: ${error.message}`);
        },
      }),
    );

  const { mutate: discoverVoices, isPending: isDiscoveringVoices } =
    useMutation(
      api.tts.discoverVoices.mutationOptions({
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
    <SettingsSection
      title={t("settings.tts.tts_settings")}
      description="Configure the OpenAI-compatible text-to-speech server used to narrate your bookmarks."
    >
      <Field className="rounded-lg border p-3">
        <FieldLabel htmlFor="tts-base-url">Base URL</FieldLabel>
        <FieldDescription>
          e.g. http://localhost:8880/v1 (an OpenAI-compatible endpoint, such as
          Kokoro-FastAPI&apos;s)
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
        <FieldDescription>
          Discover the models your server offers, or type one manually.
        </FieldDescription>
        <div className="flex gap-2">
          {discoveredModels.length > 0 ? (
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger id="tts-model" className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {discoveredModels.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="tts-model"
              className="flex-1"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          )}
          <ActionButton
            type="button"
            variant="outline"
            loading={isDiscoveringModels}
            disabled={!baseUrl}
            onClick={() =>
              discoverModels({ baseUrl, apiKey: apiKey || undefined })
            }
          >
            <Search className="mr-2 size-4" />
            Discover
          </ActionButton>
        </div>
      </Field>

      <Field className="rounded-lg border p-3">
        <FieldLabel htmlFor="tts-voice">Voice</FieldLabel>
        <FieldDescription>
          Discover the voices your server offers, or type one manually (e.g.
          af_heart). When your server reports voice quality, the highest quality
          voices are listed first.
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
                    <SelectItem key={v.id} value={v.id}>
                      <span className="flex items-center gap-2">
                        {v.id}
                        {v.targetQuality && (
                          <Badge variant="secondary">{v.targetQuality}</Badge>
                        )}
                      </span>
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
            loading={isDiscoveringVoices}
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
              provider: "openai-compatible",
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
    </SettingsSection>
  );
}

export default function TTSSettings() {
  const { t } = useTranslation();
  return (
    <SettingsPage
      title={t("settings.tts.tts_settings")}
      description="Karakeep can narrate your bookmarks using any OpenAI-compatible text-to-speech server (e.g. a self-hosted Kokoro-FastAPI instance)."
    >
      <TTSProviderSettings />
    </SettingsPage>
  );
}
