"use client";

import { useState } from "react";
import Link from "next/link";
import { BookmarkTagsEditor } from "@/components/dashboard/bookmarks/BookmarkTagsEditor";
import { FullPageSpinner } from "@/components/ui/full-page-spinner";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSession } from "@/lib/auth/client";
import useRelativeTime from "@/lib/hooks/relative-time";
import { useTranslation } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  Building,
  CalendarDays,
  ExternalLink,
  Globe,
  PanelRightClose,
  PanelRightOpen,
  User,
} from "lucide-react";

import { useTRPC } from "@karakeep/shared-react/trpc";
import { BookmarkTypes, ZBookmark } from "@karakeep/shared/types/bookmarks";
import {
  getBookmarkRefreshInterval,
  getBookmarkTitle,
  getSourceUrl,
  isBookmarkStillCrawling,
} from "@karakeep/shared/utils/bookmarkUtils";

import SummarizeBookmarkArea from "../bookmarks/SummarizeBookmarkArea";
import TtsBookmarkArea from "../bookmarks/TtsBookmarkArea";
import ActionBar from "./ActionBar";
import { AssetContentSection } from "./AssetContentSection";
import AttachmentBox from "./AttachmentBox";
import HighlightsBox from "./HighlightsBox";
import LinkContentSection from "./LinkContentSection";
import { NoteEditor } from "./NoteEditor";
import { TextContentSection } from "./TextContentSection";

function ContentLoading() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4">
      <Globe className="h-12 w-12 animate-bounce text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        {t("preview.crawling_in_progress")}
      </p>
    </div>
  );
}

function CreationTime({ createdAt }: { createdAt: Date }) {
  const { i18n } = useTranslation();
  const { fromNow, localCreatedAt } = useRelativeTime(createdAt, i18n.language);
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <span className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays size={16} /> {fromNow}
        </span>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent>{localCreatedAt}</TooltipContent>
      </TooltipPortal>
    </Tooltip>
  );
}

function BookmarkMetadata({ bookmark }: { bookmark: ZBookmark }) {
  let { author, publisher, datePublished } =
    bookmark.content.type !== BookmarkTypes.LINK
      ? {
          author: null,
          publisher: null,
          datePublished: null,
        }
      : bookmark.content;

  return (
    <div className="flex flex-col gap-2">
      <CreationTime createdAt={bookmark.createdAt} />
      {author && (
        <div className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
          <User size={16} />
          <span>By {author}</span>
        </div>
      )}
      {publisher && (
        <div className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
          <Building size={16} />
          <span>{publisher}</span>
        </div>
      )}
      {datePublished && <PublishedDate datePublished={datePublished} />}
    </div>
  );
}

function PublishedDate({ datePublished }: { datePublished: Date }) {
  const { i18n } = useTranslation();
  const { fromNow, localCreatedAt } = useRelativeTime(
    datePublished,
    i18n.language,
  );
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <div className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays size={16} />
          <span>Published {fromNow}</span>
        </div>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent>{localCreatedAt}</TooltipContent>
      </TooltipPortal>
    </Tooltip>
  );
}

export default function BookmarkPreview({
  bookmarkId,
  initialData,
}: {
  bookmarkId: string;
  initialData?: ZBookmark;
  onClose?: () => void;
}) {
  const api = useTRPC();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<string>("content");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Tracks which section of a link bookmark is showing (reader view,
  // screenshot, PDF, etc.) so the floating TTS control can hide itself
  // outside of reader view, where there's no narration text to play.
  const [linkSection, setLinkSection] = useState<string | null>(null);
  const { data: session } = useSession();

  const { data: bookmark } = useQuery(
    api.bookmarks.getBookmark.queryOptions(
      {
        bookmarkId,
      },
      {
        initialData,
        refetchInterval: (query) => {
          const data = query.state.data;
          if (!data) {
            return false;
          }
          return getBookmarkRefreshInterval(data);
        },
      },
    ),
  );

  if (!bookmark) {
    return <FullPageSpinner />;
  }

  // Check if the current user owns this bookmark
  const isOwner = session?.user?.id === bookmark.userId;

  let content;
  switch (bookmark.content.type) {
    case BookmarkTypes.LINK: {
      content = (
        <LinkContentSection
          bookmark={bookmark}
          onSectionChange={setLinkSection}
        />
      );
      break;
    }
    case BookmarkTypes.TEXT: {
      content = <TextContentSection bookmark={bookmark} />;
      break;
    }
    case BookmarkTypes.ASSET: {
      content = <AssetContentSection bookmark={bookmark} />;
      break;
    }
  }

  const sourceUrl = getSourceUrl(bookmark);
  const title = getBookmarkTitle(bookmark);

  // Common content for both layouts
  const contentSection = isBookmarkStillCrawling(bookmark) ? (
    <ContentLoading />
  ) : (
    content
  );

  // Rendered outside the mobile Content/Details tabs (and outside the
  // collapsible desktop sidebar) so switching tabs or collapsing the sidebar
  // doesn't unmount it mid-playback.
  const ttsSection = (
    <TtsBookmarkArea bookmark={bookmark} readOnly={!isOwner} />
  );
  // There's no narration text for the Page Overview/Screenshot/PDF/Archive/
  // Video sections, so only surface the control in reader view. Text
  // bookmarks have no sections at all, so they're always eligible. Stays
  // mounted (just visually hidden) so switching sections never interrupts
  // playback; `linkSection === null` means the child hasn't reported in yet,
  // which defaults to showing since most bookmarks default to reader view.
  const isReaderViewActive =
    bookmark.content.type !== BookmarkTypes.LINK ||
    linkSection === null ||
    linkSection === "cached";

  const detailsSection = (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="line-clamp-2 text-ellipsis break-words text-lg font-medium">
          {!title ? "Untitled" : title}
        </p>
        {sourceUrl && (
          <Link
            href={sourceUrl}
            target="_blank"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="size-3" />
            <span>{t("preview.view_original")}</span>
          </Link>
        )}
      </div>
      <Separator />
      <BookmarkMetadata bookmark={bookmark} />
      <SummarizeBookmarkArea bookmark={bookmark} readOnly={!isOwner} />
      <Separator />
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("common.tags")}
        </p>
        <BookmarkTagsEditor bookmark={bookmark} disabled={!isOwner} />
      </div>
      <Separator />
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("common.note")}
        </p>
        <NoteEditor bookmark={bookmark} disabled={!isOwner} />
      </div>
      <Separator />
      <AttachmentBox bookmark={bookmark} readOnly={!isOwner} />
      <HighlightsBox bookmarkId={bookmark.id} readOnly={!isOwner} />
      <Separator />
      {isOwner && <ActionBar bookmark={bookmark} />}
    </div>
  );

  // Floating over the reading area, confined to just the reader pane (not
  // the details sidebar). Hidden via CSS rather than unmounted when
  // collapsing the sidebar or leaving reader view, so playback never gets
  // interrupted.
  const floatingTts = (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4",
        !isReaderViewActive && "hidden",
      )}
    >
      <div className="pointer-events-auto">{ttsSection}</div>
    </div>
  );

  return (
    <>
      {/* Render original layout for wide screens */}
      <div className="hidden h-full flex-col overflow-hidden bg-background lg:flex">
        <div className="flex min-h-0 flex-1">
          <div className="relative h-full flex-1 overflow-auto px-4 py-4">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="absolute right-4 top-4 z-10 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {sidebarCollapsed ? (
                <PanelRightOpen size={20} />
              ) : (
                <PanelRightClose size={20} />
              )}
            </button>
            {contentSection}
            {floatingTts}
          </div>
          {!sidebarCollapsed && (
            <div className="flex w-1/3 flex-col gap-3 overflow-auto border-l bg-muted/40 p-5">
              {detailsSection}
            </div>
          )}
        </div>
      </div>
      {/* Render tabbed layout for narrow/vertical screens */}
      <div className="relative flex h-full w-full flex-col overflow-hidden lg:hidden">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <TabsList className="z-10 mx-4 mt-2 grid w-auto grid-cols-2">
            <TabsTrigger value="content">
              {t("preview.tabs.content")}
            </TabsTrigger>
            <TabsTrigger value="details">
              {t("preview.tabs.details")}
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="content"
            className="h-full flex-1 overflow-hidden overflow-y-auto bg-background px-4 py-3 data-[state=inactive]:hidden"
          >
            {contentSection}
          </TabsContent>
          <TabsContent
            value="details"
            className="h-full overflow-y-auto bg-background px-4 py-3 data-[state=inactive]:hidden"
          >
            {detailsSection}
          </TabsContent>
        </Tabs>
        {/* Rendered outside the Tabs (as a sibling, not inside TabsContent) so
            switching between Content/Details never unmounts it. */}
        {floatingTts}
      </div>
    </>
  );
}
