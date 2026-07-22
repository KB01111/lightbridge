import { useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { HStack, VStack, StackItem } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import {
  ChatComposer,
  ChatComposerDrawer,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
} from '@astryxdesign/core/Chat';
import { Markdown } from '@astryxdesign/core/Markdown';
import { Token } from '@astryxdesign/core/Token';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Thumbnail } from '@astryxdesign/core/Thumbnail';
import { Toolbar } from '@astryxdesign/core/Toolbar';
import { useStreamingText } from '@astryxdesign/core/hooks';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  Cog6ToothIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

import { ipc, events, type ContextItem } from './lib/ipc';
import {
  useAppStore,
  contextFromCapture,
  estimateTokens,
} from './state/appStore';
import { SettingsDialog } from './components/SettingsDialog';
import { useEntryTransition } from './lib/useEntryTransition';

const MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'];

function contextBlock(item: ContextItem): string {
  return `[context source="${item.sourceType}" name="${item.sourceName}" ref="${item.sourceRef}"]\n${item.content}\n[/context]`;
}

// Mount-animated wrappers: each remounts when its branch renders, so the
// entry transition replays on every expand/collapse or drawer appearance.
function ExpandedPanel({ children }: { children: ReactNode }) {
  const entry = useEntryTransition('slideUp');
  return (
    <StackItem size="fill" style={{ minHeight: 0, ...entry }}>
      {children}
    </StackItem>
  );
}

function CollapsedComposer({ children }: { children: ReactNode }) {
  const entry = useEntryTransition('slideDown', '--duration-fast');
  return (
    <VStack gap={0} style={{ padding: 'var(--spacing-2)', ...entry }}>
      {children}
    </VStack>
  );
}

function DrawerContent({ children }: { children: ReactNode }) {
  const entry = useEntryTransition('fadeIn', '--duration-fast');
  return (
    <HStack gap={1} wrap="wrap" vAlign="center" style={entry}>
      {children}
    </HStack>
  );
}

export default function App() {
  const queryClient = useQueryClient();
  const {
    expanded,
    composerValue,
    conversationId,
    model,
    streamId,
    streamState,
    streamingText,
    streamError,
    capture,
    contextItems,
    setExpanded,
    setComposerValue,
    setConversationId,
    setModel,
    startStream,
    appendDelta,
    finishStream,
    failStream,
    setCapture,
    setContextItems,
    toggleContextItem,
    removeContextItem,
    setSettingsOpen,
  } = useAppStore();

  const messagesQuery = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => ipc.listMessages(conversationId!),
    enabled: conversationId != null,
  });

  const apiKeyQuery = useQuery({
    queryKey: ['hasApiKey'],
    queryFn: () => ipc.hasApiKey(),
  });

  // Wire backend events once.
  useEffect(() => {
    const unlisteners: Array<Promise<() => void>> = [
      events.onCapture((c) => {
        setCapture(c);
        setContextItems(contextFromCapture(c));
      }),
      events.onOcrUpdated((c) => {
        setCapture(c);
        setContextItems(contextFromCapture(c));
      }),
      events.onChatDelta((d) => {
        if (d.streamId === useAppStore.getState().streamId) {
          appendDelta(d.delta);
        }
      }),
      events.onChatDone(() => {
        finishStream();
        void queryClient.invalidateQueries({ queryKey: ['messages'] });
      }),
      events.onChatError((e) => failStream(e.message)),
      events.onOverlayShown(() => {
        void ipc.captureForeground().then((c) => {
          setCapture(c);
          setContextItems(contextFromCapture(c));
        }).catch(() => {
          /* self-capture refused or no target — keep prior context */
        });
      }),
    ];
    void ipc.getLastCapture().then((c) => {
      if (c != null) {
        setCapture(c);
        setContextItems(contextFromCapture(c));
      }
    });
    return () => {
      for (const p of unlisteners) void p.then((un) => un());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc hides the overlay; Ctrl+E toggles expansion.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void ipc.hideOverlay();
      if (e.key === 'e' && e.ctrlKey) {
        e.preventDefault();
        setExpanded(!useAppStore.getState().expanded);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setExpanded]);

  const includedItems = useMemo(
    () => contextItems.filter((it) => it.included),
    [contextItems],
  );
  const totalTokens = useMemo(
    () =>
      includedItems.reduce((sum, it) => sum + it.tokenEstimate, 0) +
      estimateTokens(composerValue),
    [includedItems, composerValue],
  );

  const submit = async (value: string) => {
    const text = value.trim();
    if (text.length === 0 || streamState === 'streaming') return;
    if (apiKeyQuery.data !== true) {
      setSettingsOpen(true);
      return;
    }
    let convId = conversationId;
    if (convId == null) {
      const conv = await ipc.createConversation(text.slice(0, 60));
      convId = conv.id;
      setConversationId(convId);
    }
    setComposerValue('');
    setExpanded(true);
    const id = await ipc.startChat({
      conversationId: convId,
      userMessage: text,
      contextBlocks: includedItems
        .filter((it) => it.content.length > 0)
        .map(contextBlock),
      model,
    });
    startStream(id);
    void queryClient.invalidateQueries({ queryKey: ['messages', convId] });
  };

  const stop = () => {
    if (streamId != null) void ipc.cancelChat(streamId);
  };

  const displayedStreamingText = useStreamingText(
    streamingText,
    streamState === 'streaming',
  );

  const ocrStatus = capture?.ocrStatus;
  const ocrDot =
    ocrStatus === 'done'
      ? { variant: 'success' as const, label: 'OCR complete' }
      : ocrStatus === 'pending'
        ? { variant: 'accent' as const, label: 'OCR running' }
        : ocrStatus === 'failed'
          ? { variant: 'error' as const, label: 'OCR failed' }
          : { variant: 'neutral' as const, label: 'No capture' };

  const drawer =
    contextItems.length > 0 ? (
      <ChatComposerDrawer count={contextItems.length} label="Context">
        <DrawerContent>
          {capture != null && (
            <Thumbnail
              src={capture.previewBase64}
              alt={`Screenshot of ${capture.window.title}`}
              label={`${capture.window.appName} screenshot`}
            />
          )}
          {contextItems.map((item) => (
            <Token
              key={item.id}
              label={item.sourceName}
              color={item.included ? 'blue' : 'gray'}
              description={item.preview}
              onClick={() => toggleContextItem(item.id)}
              onRemove={() => removeContextItem(item.id)}
            />
          ))}
        </DrawerContent>
      </ChatComposerDrawer>
    ) : undefined;

  const composer = (
    <ChatComposer
      onSubmit={(v) => void submit(v)}
      onStop={stop}
      isStopShown={streamState === 'streaming'}
      value={composerValue}
      onChange={setComposerValue}
      placeholder={
        capture != null
          ? `Ask about ${capture.window.appName}...`
          : 'Ask LightBridge...'
      }
      density="compact"
      drawer={drawer}
      headerContext={
        <Text type="supporting" color="secondary">
          ~{totalTokens} tokens · {includedItems.length} context
        </Text>
      }
      footerActions={
        <HStack gap={1} vAlign="center">
          {MODELS.map((m) => (
            <Button
              key={m}
              label={m}
              size="sm"
              variant={m === model ? 'secondary' : 'ghost'}
              onClick={() => setModel(m)}
            />
          ))}
        </HStack>
      }
      status={
        streamState === 'error' && streamError != null
          ? { type: 'error', message: streamError }
          : undefined
      }
    />
  );

  return (
    <VStack style={{ height: '100dvh', width: '100%' }}>
      <Toolbar
        label="LightBridge"
        dividers={expanded ? ['bottom'] : []}
        startContent={
          <HStack gap={2} vAlign="center">
            <StatusDot
              variant={ocrDot.variant}
              label={ocrDot.label}
              tooltip={ocrDot.label}
              isPulsing={ocrStatus === 'pending'}
            />
            <VStack gap={0}>
              <Text type="label" weight="semibold">
                {capture?.window.appName ?? 'LightBridge'}
              </Text>
              <Text type="supporting" color="secondary">
                {capture?.window.title ?? 'Press Ctrl+Shift+Space over any window'}
              </Text>
            </VStack>
          </HStack>
        }
        endContent={
          <HStack gap={1} vAlign="center">
            <Button
              label="Settings"
              variant="ghost"
              size="sm"
              icon={<Icon icon={Cog6ToothIcon} size="sm" />}
              isIconOnly
              onClick={() => setSettingsOpen(true)}
            />
            <Button
              label={expanded ? 'Collapse' : 'Expand'}
              variant="ghost"
              size="sm"
              icon={
                <Icon
                  icon={expanded ? ChevronUpIcon : ChevronDownIcon}
                  size="sm"
                />
              }
              isIconOnly
              onClick={() => setExpanded(!expanded)}
            />
            <Button
              label="Hide"
              variant="ghost"
              size="sm"
              icon={<Icon icon={XMarkIcon} size="sm" />}
              isIconOnly
              onClick={() => void ipc.hideOverlay()}
            />
          </HStack>
        }
      />

      {expanded ? (
        <ExpandedPanel>
          <ChatLayout density="compact" style={{ height: '100%' }} composer={composer}>
            <ChatMessageList
              density="compact"
              isStreaming={streamState === 'streaming'}
              emptyState={
                <Text type="supporting" color="secondary">
                  Ask a question about the captured window, or anything else.
                </Text>
              }>
              {(messagesQuery.data ?? [])
                .filter((m) => m.role !== 'system')
                .map((m) => (
                  <ChatMessage
                    key={m.id}
                    sender={m.role === 'user' ? 'user' : 'assistant'}>
                    <ChatMessageBubble
                      variant={m.role === 'user' ? 'filled' : 'ghost'}>
                      {m.role === 'assistant' ? (
                        <Markdown density="compact">{m.content}</Markdown>
                      ) : (
                        m.content
                      )}
                    </ChatMessageBubble>
                  </ChatMessage>
                ))}
              {streamState === 'streaming' && (
                <ChatMessage sender="assistant">
                  <ChatMessageBubble variant="ghost">
                    {displayedStreamingText.length > 0 ? (
                      <Markdown density="compact">{displayedStreamingText}</Markdown>
                    ) : (
                      <Text type="supporting" color="secondary">
                        Thinking…
                      </Text>
                    )}
                  </ChatMessageBubble>
                </ChatMessage>
              )}
            </ChatMessageList>
          </ChatLayout>
        </ExpandedPanel>
      ) : (
        <CollapsedComposer>{composer}</CollapsedComposer>
      )}

      <SettingsDialog />
    </VStack>
  );
}
