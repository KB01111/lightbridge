import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCurrentWindow } from '@tauri-apps/api/window';

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
import { Banner } from '@astryxdesign/core/Banner';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { useStreamingText } from '@astryxdesign/core/hooks';
import {
  ArrowPathIcon,
  BoltIcon,
  ClipboardDocumentIcon,
  ClockIcon,
  Cog6ToothIcon,
  PlusIcon,
  ShieldCheckIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

import { events, ipc } from './lib/ipc';
import {
  useAppStore,
  contextFromCapture,
  estimateTokens,
  selectionsFromContext,
  resolveConversationContext,
} from './state/appStore';
import { HistoryDialog } from './components/HistoryDialog';
import { PrivacyDialog } from './components/PrivacyDialog';
import { useSurfaceReady } from './lib/useSurfaceReady';

export default function App() {
  const queryClient = useQueryClient();
  const didRestoreSession = useRef(false);
  const [lastSubmitted, setLastSubmitted] = useState('');
  const {
    composerValue,
    conversationId,
    routeId,
    streamId,
    streamState,
    streamingText,
    streamError,
    capture,
    contextItems,
    captureStatus,
    setComposerValue,
    setConversationId,
    setRouteId,
    startStream,
    appendDelta,
    finishStream,
    failStream,
    setCapture,
    setContextItems,
    toggleContextItem,
    removeContextItem,
    setLibraryOpen,
    setPrivacyOpen,
    setCaptureStatus,
  } = useAppStore();

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: ipc.getSettings,
  });
  useSurfaceReady('main', settingsQuery.isFetched);
  const gatewayQuery = useQuery({
    queryKey: ['gatewayStatus'],
    queryFn: ipc.getGatewayStatus,
    refetchInterval: 15_000,
  });
  const messagesQuery = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => ipc.listMessages(conversationId!),
    enabled: conversationId != null,
  });

  const applyCapture = (
    nextCapture: NonNullable<typeof capture>,
    preserveIncluded = false,
  ) => {
    setCapture(nextCapture);
    const newItems = contextFromCapture(nextCapture);
    if (!preserveIncluded) {
      setContextItems(newItems);
      return;
    }
    const includedMap = new Map(
      useAppStore
        .getState()
        .contextItems.map((item) => [item.id, item.included]),
    );
    setContextItems(
      newItems.map((item) => ({
        ...item,
        included: includedMap.get(item.id) ?? item.included,
      })),
    );
  };

  const hydrateConversation = async (id: string) => {
    const selections = await ipc.getConversationContext(id);
    if (selections.length === 0) return;
    const resolved = await resolveConversationContext(
      selections,
      ipc.getCapture,
    );
    if (resolved.capture != null) setCapture(resolved.capture);
    setContextItems(resolved.items);
  };

  useEffect(() => {
    const unlisteners = [
      events.onCapture((nextCapture) => applyCapture(nextCapture)),
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
      events.onGatewayStatus((status) => {
        queryClient.setQueryData(['gatewayStatus'], status);
      }),
      events.onSettingsChanged(() => {
        void queryClient.invalidateQueries({ queryKey: ['settings'] });
        void queryClient.invalidateQueries({ queryKey: ['gatewayStatus'] });
      }),
    ];
    return () => {
      for (const listener of unlisteners) {
        void listener.then((unlisten) => unlisten());
      }
    };
    // Event bridges intentionally mount once per webview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const settings = settingsQuery.data;
    if (settings == null) return;
    setRouteId(settings.aiProfile);
    if (!settings.privacyAcknowledged) setPrivacyOpen(true);
    if (didRestoreSession.current) return;
    didRestoreSession.current = true;
    if (settings.lastActiveConversation != null) {
      setConversationId(settings.lastActiveConversation);
      void hydrateConversation(settings.lastActiveConversation);
    } else {
      void ipc.getLastCapture().then((lastCapture) => {
        if (lastCapture != null) applyCapture(lastCapture);
      });
    }
    // Hydrate once from persisted backend state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQuery.data]);

  useEffect(() => {
    if (!didRestoreSession.current) return;
    void ipc
      .setLastActiveConversation(conversationId)
      .then((settings) => queryClient.setQueryData(['settings'], settings))
      .catch((error) => failStream(String(error)));
  }, [conversationId, failStream, queryClient]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void ipc.hideOverlay();
      if (event.key.toLowerCase() === 'n' && event.ctrlKey) {
        event.preventDefault();
        setConversationId(null);
        setComposerValue('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setComposerValue, setConversationId]);

  const includedItems = useMemo(
    () => contextItems.filter((item) => item.included),
    [contextItems],
  );
  const totalTokens = useMemo(
    () =>
      includedItems.reduce((total, item) => total + item.tokenEstimate, 0) +
      estimateTokens(composerValue),
    [composerValue, includedItems],
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
    if (gatewayQuery.data?.healthy !== true) {
      await ipc.showSettings();
      return;
    }
    try {
      let activeConversation = conversationId;
      if (activeConversation == null) {
        const conversation = await ipc.createConversation(text.slice(0, 60));
        activeConversation = conversation.id;
        setConversationId(activeConversation);
      }
      setLastSubmitted(text);
      setComposerValue('');
      const nextStreamId = crypto.randomUUID();
      startStream(nextStreamId);
      await ipc.startChat({
        streamId: nextStreamId,
        conversationId: activeConversation,
        userMessage: text,
        contextSelections: selectionsFromContext(contextItems),
        routeId,
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
  const captureBusy =
    captureStatus.phase === 'capturing' || captureStatus.phase === 'ocr';
  const gatewayReady = gatewayQuery.data?.healthy === true;
  const routeOptions = (settingsQuery.data?.modelRoutes ?? []).map((route) => ({
    value: route.id,
    label: `${route.label} · ${route.model}`,
  }));
  const contextDrawer =
    contextItems.length > 0 ? (
      <ChatComposerDrawer count={contextItems.length} label="Context">
        <HStack gap={1} wrap="wrap" vAlign="center">
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
              label="Sent only when you press Send"
              color="orange"
              icon={<Icon icon={ShieldCheckIcon} size="sm" />}
            />
          )}
        </HStack>
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
          : 'Ask LightBridge anything…'
      }
      density="compact"
      drawer={contextDrawer}
      headerContext={
        <Text type="supporting" color="secondary">
          ~{totalTokens} tokens · {includedItems.length} selected
        </Text>
      }
      footerActions={
        <Selector
          label="Model route"
          isLabelHidden
          size="sm"
          value={routeId}
          options={routeOptions}
          onChange={(nextRoute) => {
            void ipc
              .setAiProfile(nextRoute)
              .then((settings) => {
                queryClient.setQueryData(['settings'], settings);
                setRouteId(settings.aiProfile);
              })
              .catch((error) => failStream(String(error)));
          }}
        />
      }
      status={
        streamState === 'error' && streamError != null
          ? { type: 'error', message: streamError }
          : !gatewayReady
            ? { type: 'warning', message: 'Connect a provider in Settings.' }
            : undefined
      }
    />
  );

  return (
    <AppShell
      height="fill"
      variant="surface"
      contentPadding={0}>
      <VStack style={{ height: '100%', minHeight: 0 }}>
        <Toolbar
          label="LightBridge overlay"
          dividers={['bottom']}
          startContent={
            <HStack gap={2} vAlign="center">
              <StatusDot
                variant={
                  captureBusy
                    ? 'accent'
                    : gatewayReady
                      ? 'success'
                      : 'warning'
                }
                label={
                  captureBusy
                    ? captureStatus.message
                    : gatewayQuery.data?.message ?? 'Checking Bifrost'
                }
                isPulsing={captureBusy || streamState === 'streaming'}
              />
              <VStack gap={0}>
                <Text type="label" weight="semibold">
                  {capture?.window.appName ?? 'LightBridge'}
                </Text>
                <Text type="supporting" color="secondary" maxLines={1}>
                  {capture?.window.title ??
                    `Press ${settingsQuery.data?.shortcut ?? 'Ctrl+Shift+Space'} over any window`}
                </Text>
              </VStack>
            </HStack>
          }
          endContent={
            <HStack gap={1} vAlign="center">
              <Button
                label="New conversation"
                variant="ghost"
                size="sm"
                isIconOnly
                icon={<Icon icon={PlusIcon} size="sm" />}
                isDisabled={streamState === 'streaming'}
                onClick={() => {
                  setConversationId(null);
                  setComposerValue('');
                }}
              />
              <Button
                label="Recapture"
                variant="ghost"
                size="sm"
                isIconOnly
                icon={<Icon icon={ArrowPathIcon} size="sm" />}
                isDisabled={captureBusy}
                onClick={() =>
                  void ipc.recapture().catch((error) =>
                    setCaptureStatus({
                      phase: 'failed',
                      message: String(error),
                    }),
                  )
                }
              />
              <Button
                label="History and captures"
                variant="ghost"
                size="sm"
                isIconOnly
                icon={<Icon icon={ClockIcon} size="sm" />}
                onClick={() => setLibraryOpen(true)}
              />
              <Button
                label="Settings"
                variant="ghost"
                size="sm"
                isIconOnly
                icon={<Icon icon={Cog6ToothIcon} size="sm" />}
                onClick={() => void ipc.showSettings()}
              />
              <Button
                label="Hide"
                variant="ghost"
                size="sm"
                isIconOnly
                icon={<Icon icon={XMarkIcon} size="sm" />}
                onClick={() => void ipc.hideOverlay()}
              />
            </HStack>
          }
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest('button') == null) {
              void getCurrentWindow().startDragging();
            }
          }}
        />

        {!gatewayReady && (
          <Banner
            status="warning"
            title="Connect a model provider"
            description="LightBridge uses Bifrost for every AI request."
            endContent={
              <Button
                label="Open settings"
                variant="primary"
                size="sm"
                onClick={() => void ipc.showSettings()}
              />
            }
          />
        )}
        {captureStatus.phase === 'failed' && (
          <Banner
            status="error"
            title="Capture failed"
            description={captureStatus.message}
            endContent={
              <Button
                label="Try again"
                variant="secondary"
                size="sm"
                onClick={() => void ipc.recapture()}
              />
            }
          />
        )}

        <StackItem size="fill" style={{ minHeight: 0 }}>
          <ChatLayout
            density="compact"
            style={{ height: '100%' }}
            composer={composer}>
            <ChatMessageList
              density="compact"
              isStreaming={streamState === 'streaming'}
              emptyState={
                messagesQuery.isPending && conversationId != null ? (
                  <Text type="supporting" color="secondary">
                    Loading conversation…
                  </Text>
                ) : (
                  <EmptyState
                    title="Bring any window into the conversation"
                    description="Capture the active app, review the selected context, then ask a question."
                    icon={<Icon icon={SparklesIcon} size="lg" />}
                    isCompact
                    actions={
                      <HStack gap={2}>
                        <Button
                          label="Capture window"
                          variant="primary"
                          icon={<Icon icon={BoltIcon} size="sm" />}
                          onClick={() => void ipc.captureForeground()}
                        />
                        <Button
                          label="Open history"
                          variant="secondary"
                          onClick={() => setLibraryOpen(true)}
                        />
                      </HStack>
                    }
                  />
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
                    sender={message.role === 'user' ? 'user' : 'assistant'}>
                    <ChatMessageBubble
                      variant={message.role === 'user' ? 'filled' : 'ghost'}
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
                                />
                                <Text type="supporting" color="secondary">
                                  {message.model ?? 'Unknown model'}
                                </Text>
                                <Button
                                  label="Copy response"
                                  variant="ghost"
                                  size="sm"
                                  isIconOnly
                                  icon={
                                    <Icon
                                      icon={ClipboardDocumentIcon}
                                      size="sm"
                                    />
                                  }
                                  onClick={() =>
                                    void navigator.clipboard.writeText(
                                      message.content,
                                    )
                                  }
                                />
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
                      <VStack gap={1}>
                        <Text type="supporting" color="secondary">
                          Bifrost is choosing the best route…
                        </Text>
                        <StatusDot
                          variant="accent"
                          label="Generating"
                          isPulsing
                        />
                      </VStack>
                    )}
                  </ChatMessageBubble>
                </ChatMessage>
              )}
            </ChatMessageList>
          </ChatLayout>
        </StackItem>

        {streamState === 'error' && lastSubmitted.length > 0 && (
          <HStack
            gap={2}
            hAlign="end"
            style={{ padding: 'var(--spacing-2)' }}>
            <Button
              label="Restore prompt"
              variant="secondary"
              size="sm"
              onClick={() => setComposerValue(lastSubmitted)}
            />
          </HStack>
        )}
        <HistoryDialog />
        <PrivacyDialog />
      </VStack>
    </AppShell>
  );
}
