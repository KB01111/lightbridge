import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { AppShell } from '@astryxdesign/core/AppShell';
import { HStack, VStack, StackItem } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import {
  ChatComposer,
  ChatComposerDrawer,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
} from '@astryxdesign/core/Chat';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { Markdown } from '@astryxdesign/core/Markdown';
import { Token } from '@astryxdesign/core/Token';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Selector } from '@astryxdesign/core/Selector';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Thumbnail } from '@astryxdesign/core/Thumbnail';
import { Toolbar } from '@astryxdesign/core/Toolbar';
import { Banner } from '@astryxdesign/core';
import { useStreamingText } from '@astryxdesign/core/hooks';
import {
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClipboardDocumentIcon,
  ClockIcon,
  Cog6ToothIcon,
  ShieldCheckIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

import {
  ipc,
  events,
  type AiProfile,
} from './lib/ipc';
import {
  useAppStore,
  contextFromCapture,
  estimateTokens,
  selectionsFromContext,
  resolveConversationContext,
} from './state/appStore';
import { SettingsDialog } from './components/SettingsDialog';
import { HistoryDialog } from './components/HistoryDialog';
import { PrivacyDialog } from './components/PrivacyDialog';
import { useEntryTransition } from './lib/useEntryTransition';

const PROFILE_OPTIONS = [
  { value: 'best', label: 'Best · Sol' },
  { value: 'balanced', label: 'Balanced · Terra' },
  { value: 'fast', label: 'Fast · Luna' },
];

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
  const [settingsReady, setSettingsReady] = useState(false);
  const didRestoreSession = useRef(false);
  const store = useAppStore();
  const {
    expanded,
    composerValue,
    conversationId,
    profile,
    streamId,
    streamState,
    streamingText,
    streamError,
    capture,
    contextItems,
    captureStatus,
    setExpanded,
    setComposerValue,
    setConversationId,
    setProfile,
    startStream,
    appendDelta,
    finishStream,
    failStream,
    setCapture,
    setContextItems,
    toggleContextItem,
    removeContextItem,
    setSettingsOpen,
    setLibraryOpen,
    setPrivacyOpen,
    setCaptureStatus,
  } = store;

  const messagesQuery = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => ipc.listMessages(conversationId!),
    enabled: conversationId != null,
  });
  const apiKeyQuery = useQuery({
    queryKey: ['hasApiKey'],
    queryFn: () => ipc.hasApiKey(),
  });
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => ipc.getSettings(),
  });

  const applyCapture = (nextCapture: NonNullable<typeof capture>, preserveIncluded = false) => {
    setCapture(nextCapture);
    const newItems = contextFromCapture(nextCapture);
    if (preserveIncluded) {
      const currentItems = useAppStore.getState().contextItems;
      const includedMap = new Map(
        currentItems.map((item) => [item.id, item.included]),
      );
      const mergedItems = newItems.map((item) => ({
        ...item,
        included: includedMap.has(item.id) ? includedMap.get(item.id)! : item.included,
      }));
      setContextItems(mergedItems);
    } else {
      setContextItems(newItems);
    }
  };

  const hydrateConversation = async (id: string) => {
    const selections = await ipc.getConversationContext(id);
    if (selections.length === 0) return;
    const { capture, items } = await resolveConversationContext(
      selections,
      ipc.getCapture,
    );
    if (capture != null) setCapture(capture);
    setContextItems(items);
  };

  useEffect(() => {
    const unlisteners: Array<Promise<() => void>> = [
      events.onCapture(applyCapture),
      events.onOcrUpdated((updated) => {
        if (useAppStore.getState().capture?.id === updated.id) {
          applyCapture(updated, true);
        }
      }),
      events.onCaptureStatus(setCaptureStatus),
      events.onChatDelta((delta) => {
        if (delta.streamId === useAppStore.getState().streamId) {
          appendDelta(delta.delta);
        }
      }),
      events.onChatFinished((finished) => {
        if (finished.streamId === useAppStore.getState().streamId) {
          finishStream(finished.status, finished.error);
        }
        void queryClient.invalidateQueries({
          queryKey: ['messages', finished.conversationId],
        });
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      }),
      events.onCaptureRequest(() => {
        void ipc.captureForeground().catch((error) => {
          setCaptureStatus({ phase: 'failed', message: String(error) });
        });
      }),
    ];
    return () => {
      for (const listener of unlisteners) void listener.then((unlisten) => unlisten());
    };
    // The event bridge is intentionally mounted once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const settings = settingsQuery.data;
    if (settings == null) return;
    setProfile(settings.aiProfile);
    if (!settings.privacyAcknowledged) setPrivacyOpen(true);
    if (!didRestoreSession.current) {
      didRestoreSession.current = true;
      if (
        useAppStore.getState().conversationId == null &&
        settings.lastActiveConversation != null
      ) {
        setConversationId(settings.lastActiveConversation);
        void hydrateConversation(settings.lastActiveConversation);
      } else if (
        useAppStore.getState().conversationId == null &&
        useAppStore.getState().capture == null
      ) {
        void ipc.getLastCapture().then((lastCapture) => {
          if (lastCapture != null) applyCapture(lastCapture);
        });
      }
    }
    setSettingsReady(true);
    // Hydrate once per backend settings revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQuery.data]);

  useEffect(() => {
    if (!settingsReady) return;
    void ipc
      .setLastActiveConversation(conversationId)
      .then((settings) => queryClient.setQueryData(['settings'], settings))
      .catch((error) => failStream(String(error)));
  }, [conversationId, failStream, queryClient, settingsReady]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void ipc.hideOverlay();
      if (event.key === 'e' && event.ctrlKey) {
        event.preventDefault();
        setExpanded(!useAppStore.getState().expanded);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setExpanded]);

  const includedItems = useMemo(
    () => contextItems.filter((item) => item.included),
    [contextItems],
  );
  const totalTokens = useMemo(
    () =>
      includedItems.reduce((total, item) => total + item.tokenEstimate, 0) +
      estimateTokens(composerValue),
    [includedItems, composerValue],
  );
  const hasSensitiveContext = includedItems.some(
    (item) => item.privacy === 'sensitive',
  );

  const submit = async (value: string) => {
    const text = value.trim();
    if (text.length === 0 || streamState === 'streaming') return;
    if (settingsQuery.data?.privacyAcknowledged !== true) {
      setPrivacyOpen(true);
      return;
    }
    if (apiKeyQuery.data !== true) {
      setSettingsOpen(true);
      return;
    }
    try {
      let activeConversation = conversationId;
      if (activeConversation == null) {
        const conversation = await ipc.createConversation(text.slice(0, 60));
        activeConversation = conversation.id;
        setConversationId(activeConversation);
      }
      setComposerValue('');
      setExpanded(true);
      const nextStreamId = crypto.randomUUID();
      startStream(nextStreamId);
      await ipc.startChat({
        streamId: nextStreamId,
        conversationId: activeConversation,
        userMessage: text,
        contextSelections: selectionsFromContext(contextItems),
        profile,
      });
      await queryClient.invalidateQueries({
        queryKey: ['messages', activeConversation],
      });
    } catch (error) {
      failStream(String(error));
    }
  };

  const displayedStreamingText = useStreamingText(
    streamingText,
    streamState === 'streaming',
  );
  const ocrStatus = capture?.ocrStatus;
  const recapture = () =>
    void ipc.recapture().catch((error) => {
      setCaptureStatus({ phase: 'failed', message: String(error) });
    });
  const ocrDot =
    captureStatus.phase === 'failed' || ocrStatus === 'failed'
      ? { variant: 'error' as const, label: 'Capture needs attention' }
      : captureStatus.phase === 'capturing' || captureStatus.phase === 'ocr'
        ? { variant: 'accent' as const, label: captureStatus.message }
        : ocrStatus === 'done'
          ? { variant: 'success' as const, label: 'Capture ready' }
          : { variant: 'neutral' as const, label: 'No active capture' };

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
          {hasSensitiveContext && (
            <Token
              label="Sensitive · sent only on Send"
              color="orange"
              icon={<Icon icon={ShieldCheckIcon} size="sm" />}
            />
          )}
        </DrawerContent>
      </ChatComposerDrawer>
    ) : undefined;

  const composer = (
    <ChatComposer
      onSubmit={(value) => void submit(value)}
      onStop={() => {
        if (streamId != null) void ipc.cancelChat(streamId);
      }}
      isStopShown={streamState === 'streaming'}
      value={composerValue}
      onChange={setComposerValue}
      placeholder={
        capture != null
          ? `Ask about ${capture.window.appName}…`
          : 'Ask LightBridge…'
      }
      density="compact"
      drawer={drawer}
      headerContext={
        <Text type="supporting" color="secondary">
          ~{totalTokens} tokens · {includedItems.length} context
        </Text>
      }
      footerActions={
        <Selector
          label="Answer quality"
          isLabelHidden
          size="sm"
          value={profile}
          options={PROFILE_OPTIONS}
          onChange={(value) => {
            const next = value as AiProfile;
            void ipc
              .setAiProfile(next)
              .then((settings) => {
                queryClient.setQueryData(['settings'], settings);
                setProfile(settings.aiProfile);
              })
              .catch((error) => failStream(String(error)));
          }}
        />
      }
      status={
        streamState === 'error' && streamError != null
          ? { type: 'error', message: streamError }
          : undefined
      }
    />
  );

  return (
    <AppShell height="fill" variant="surface" contentPadding={0}>
      <VStack style={{ height: '100%', width: '100%' }}>
        <Toolbar
          label="LightBridge"
          dividers={expanded ? ['bottom'] : []}
          startContent={
            <HStack gap={2} vAlign="center">
              <StatusDot
                variant={ocrDot.variant}
                label={ocrDot.label}
                tooltip={ocrDot.label}
                isPulsing={
                  captureStatus.phase === 'capturing' ||
                  captureStatus.phase === 'ocr'
                }
              />
              <VStack gap={0}>
                <Text type="label" weight="semibold">
                  {capture?.window.appName ?? 'LightBridge'}
                </Text>
                <Text type="supporting" color="secondary">
                  {capture?.window.title ??
                    `Press ${settingsQuery.data?.shortcut ?? 'Ctrl+Shift+Space'} over any window`}
                </Text>
              </VStack>
            </HStack>
          }
          endContent={
            <HStack gap={1} vAlign="center">
              <Button
                label="Recapture"
                variant="ghost"
                size="sm"
                icon={<Icon icon={ArrowPathIcon} size="sm" />}
                isIconOnly
                isDisabled={
                  captureStatus.phase === 'capturing' ||
                  captureStatus.phase === 'ocr'
                }
                onClick={recapture}
              />
              <Button
                label="History and captures"
                variant="ghost"
                size="sm"
                icon={<Icon icon={ClockIcon} size="sm" />}
                isIconOnly
                onClick={() => setLibraryOpen(true)}
              />
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

        {captureStatus.phase === 'failed' && (
          <Banner
            status="error"
            container="section"
            title="Capture failed"
            description={captureStatus.message}
            endContent={
              <Button
                label="Try again"
                variant="secondary"
                size="sm"
                onClick={recapture}
              />
            }
          />
        )}

        {expanded ? (
          <ExpandedPanel>
            <ChatLayout
              density="compact"
              style={{ height: '100%' }}
              composer={composer}>
              <ChatMessageList
                density="compact"
                isStreaming={streamState === 'streaming'}
                emptyState={
                  messagesQuery.isPending ? (
                    <Text type="supporting" color="secondary">
                      Loading conversation…
                    </Text>
                  ) : messagesQuery.isError ? (
                    <Text type="supporting" color="secondary">
                      Could not load this conversation.
                    </Text>
                  ) : (
                    <Text type="supporting" color="secondary">
                      Capture a window, choose context, and ask a question.
                    </Text>
                  )
                }>
                {(messagesQuery.data ?? [])
                  .filter(
                    (message) =>
                      message.role !== 'system' &&
                      message.status !== 'streaming',
                  )
                  .map((message) => (
                    <ChatMessage
                      key={message.id}
                      sender={
                        message.role === 'user' ? 'user' : 'assistant'
                      }>
                      <ChatMessageBubble
                        variant={
                          message.role === 'user' ? 'filled' : 'ghost'
                        }
                        metadata={
                          message.role === 'assistant' ? (
                            <ChatMessageMetadata
                              timestamp={
                                <Timestamp
                                  value={message.createdAt}
                                  format="time"
                                />
                              }
                              footer={
                                <HStack gap={1} vAlign="center">
                                  <StatusDot
                                    variant={
                                      message.status === 'completed'
                                        ? 'success'
                                        : message.status === 'cancelled'
                                          ? 'neutral'
                                          : 'error'
                                    }
                                    label={message.status}
                                    tooltip={
                                      message.error ?? message.status
                                    }
                                  />
                                  <Button
                                    label="Copy"
                                    variant="ghost"
                                    size="sm"
                                    icon={
                                      <Icon
                                        icon={ClipboardDocumentIcon}
                                        size="sm"
                                      />
                                    }
                                    isIconOnly
                                    onClick={() =>
                                      void navigator.clipboard.writeText(
                                        message.content,
                                      )
                                    }
                                  />
                                  <Text type="supporting" color="secondary">
                                    {message.model ?? 'Unknown model'}
                                  </Text>
                                </HStack>
                              }
                            />
                          ) : undefined
                        }>
                        {message.role === 'assistant' ? (
                          message.content.length > 0 ? (
                            <Markdown density="compact">
                              {message.content}
                            </Markdown>
                          ) : (
                            <Text type="supporting" color="secondary">
                              No response text was saved.
                            </Text>
                          )
                        ) : (
                          message.content
                        )}
                      </ChatMessageBubble>
                    </ChatMessage>
                  ))}
                {streamState === 'streaming' && (
                  <ChatMessage sender="assistant">
                    <ChatMessageBubble variant="ghost">
                      {displayedStreamingText.length > 0 ? (
                        <Markdown density="compact">
                          {displayedStreamingText}
                        </Markdown>
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
        <HistoryDialog />
        <PrivacyDialog />
      </VStack>
    </AppShell>
  );
}
