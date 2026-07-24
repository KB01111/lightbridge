import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { List, ListItem } from '@astryxdesign/core/List';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Section } from '@astryxdesign/core/Section';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Thumbnail } from '@astryxdesign/core/Thumbnail';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import {
  ChatBubbleLeftRightIcon,
  MagnifyingGlassIcon,
  PhotoIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

import { ipc, type CaptureRecord } from '../lib/ipc';
import { useEntryTransition } from '../lib/useEntryTransition';
import { contextFromCapture, useAppStore, resolveConversationContext } from '../state/appStore';

type LibraryView = 'chats' | 'captures' | 'search';
type PendingDelete = {
  kind: 'conversation' | 'capture';
  id: string;
  label: string;
};

export function HistoryDialog() {
  const queryClient = useQueryClient();
  const libraryOpen = useAppStore((state) => state.libraryOpen);
  const setLibraryOpen = useAppStore((state) => state.setLibraryOpen);
  const conversationId = useAppStore((state) => state.conversationId);
  const setConversationId = useAppStore((state) => state.setConversationId);
  const setComposerValue = useAppStore((state) => state.setComposerValue);
  const setCapture = useAppStore((state) => state.setCapture);
  const setContextItems = useAppStore((state) => state.setContextItems);
  const streamState = useAppStore((state) => state.streamState);
  const [view, setView] = useState<LibraryView>('chats');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const entryStyle = useEntryTransition('fadeIn', '--duration-medium', libraryOpen);

  const conversationsQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: () => ipc.listConversations(),
    enabled: libraryOpen,
  });
  const capturesQuery = useQuery({
    queryKey: ['captures'],
    queryFn: () => ipc.listCaptures(100, 0),
    enabled: libraryOpen,
  });
  const searchQuery = useQuery({
    queryKey: ['searchMemory', search],
    queryFn: () => ipc.searchMemory(search.trim(), 40),
    enabled: libraryOpen && view === 'search' && search.trim().length > 1,
  });

  const applyCapture = (capture: CaptureRecord) => {
    setCapture(capture);
    setContextItems(contextFromCapture(capture));
    setLibraryOpen(false);
  };

  const openConversation = async (id: string) => {
    if (streamState === 'streaming') return;
    setError(null);
    try {
      const selections = await ipc.getConversationContext(id);
      const { capture, items } = await resolveConversationContext(
        selections,
        ipc.getCapture,
      );
      if (capture != null) setCapture(capture);
      setContextItems(items);
      setConversationId(id);
      setLibraryOpen(false);
    } catch (reason) {
      setError(`Could not open conversation: ${String(reason)}`);
    }
  };

  const openSearchHit = async (kind: string, ownerId: string) => {
    if (kind === 'message') {
      await openConversation(ownerId);
    } else {
      const capture = await ipc.getCapture(ownerId);
      if (capture == null) {
        setError('This capture was deleted.');
      } else {
        applyCapture(capture);
      }
    }
  };

  const deleteSelected = async () => {
    if (pendingDelete == null) return;
    setDeleting(true);
    setError(null);
    try {
      if (pendingDelete.kind === 'conversation') {
        await ipc.deleteConversation(pendingDelete.id);
        if (conversationId === pendingDelete.id) setConversationId(null);
      } else {
        await ipc.deleteCapture(pendingDelete.id);
        if (useAppStore.getState().capture?.id === pendingDelete.id) {
          setCapture(null);
          setContextItems([]);
        }
      }
      await queryClient.invalidateQueries();
      setPendingDelete(null);
    } catch (reason) {
      setError(`Deletion failed: ${String(reason)}`);
    } finally {
      setDeleting(false);
    }
  };

  const newConversation = () => {
    if (streamState === 'streaming') return;
    setConversationId(null);
    setComposerValue('');
    setLibraryOpen(false);
  };

  const conversations = conversationsQuery.data ?? [];
  const captures = capturesQuery.data ?? [];
  const hits = searchQuery.data ?? [];
  const isStreaming = streamState === 'streaming';

  return (
    <Dialog
      isOpen={libraryOpen}
      onOpenChange={setLibraryOpen}
      purpose="info"
      width={460}
      maxHeight="85vh">
      <DialogHeader
        title="History and context"
        subtitle="Open chats, reuse captures, or search local memory"
        onOpenChange={setLibraryOpen}
      />
      <Section variant="transparent">
        <VStack gap={3} style={entryStyle}>
          <HStack gap={1}>
            <Button
              label="Chats"
              size="sm"
              variant={view === 'chats' ? 'secondary' : 'ghost'}
              onClick={() => setView('chats')}
            />
            <Button
              label="Captures"
              size="sm"
              variant={view === 'captures' ? 'secondary' : 'ghost'}
              onClick={() => setView('captures')}
            />
            <Button
              label="Search"
              size="sm"
              variant={view === 'search' ? 'secondary' : 'ghost'}
              onClick={() => setView('search')}
            />
          </HStack>

          {view === 'chats' && (
            <VStack gap={2}>
              <Button
                label="New chat"
                variant="secondary"
                size="sm"
                icon={<Icon icon={PlusIcon} size="sm" />}
                onClick={newConversation}
                isDisabled={isStreaming}
              />
              {conversationsQuery.isPending ? (
                <Text type="supporting" color="secondary">
                  Loading chats…
                </Text>
              ) : conversationsQuery.isError ? (
                <Text type="supporting" color="secondary">
                  Could not load chats.
                </Text>
              ) : conversations.length === 0 ? (
                <EmptyState
                  title="No conversations yet"
                  description="Start a chat to see it here."
                  icon={<Icon icon={ChatBubbleLeftRightIcon} size="lg" />}
                  isCompact
                />
              ) : (
                <List density="compact" hasDividers>
                  {conversations.map((conversation) => (
                    <ListItem
                      key={conversation.id}
                      label={conversation.title}
                      isSelected={conversation.id === conversationId}
                      description={
                        <Timestamp
                          value={conversation.updatedAt}
                          format="auto"
                        />
                      }
                      startContent={
                        <Icon icon={ChatBubbleLeftRightIcon} size="sm" />
                      }
                      onClick={() => void openConversation(conversation.id)}
                      isDisabled={isStreaming}
                      endContent={
                        <Button
                          label="Delete conversation"
                          variant="ghost"
                          size="sm"
                          isIconOnly
                          icon={<Icon icon={TrashIcon} size="sm" />}
                          isDisabled={isStreaming}
                          onClick={(event) => {
                            event.stopPropagation();
                            setPendingDelete({
                              kind: 'conversation',
                              id: conversation.id,
                              label: conversation.title,
                            });
                          }}
                        />
                      }
                    />
                  ))}
                </List>
              )}
            </VStack>
          )}

          {view === 'captures' &&
            (capturesQuery.isPending ? (
              <Text type="supporting" color="secondary">
                Loading captures…
              </Text>
            ) : capturesQuery.isError ? (
              <Text type="supporting" color="secondary">
                Could not load captures.
              </Text>
            ) : captures.length === 0 ? (
              <EmptyState
                title="No captures yet"
                description="Use the global shortcut over a window."
                icon={<Icon icon={PhotoIcon} size="lg" />}
                isCompact
              />
            ) : (
              <List density="compact" hasDividers>
                {captures.map((item) => (
                  <ListItem
                    key={item.id}
                    label={item.window.appName}
                    description={item.window.title}
                    startContent={
                      <Thumbnail
                        src={item.previewBase64}
                        alt=""
                        label="Captured window"
                      />
                    }
                    onClick={() => applyCapture(item)}
                    endContent={
                      <HStack gap={1} vAlign="center">
                        <StatusDot
                          variant={
                            item.ocrStatus === 'done'
                              ? 'success'
                              : item.ocrStatus === 'pending'
                                ? 'accent'
                                : 'error'
                          }
                          label={`OCR ${item.ocrStatus}`}
                          tooltip={`OCR ${item.ocrStatus}`}
                        />
                        <Button
                          label="Delete capture"
                          variant="ghost"
                          size="sm"
                          isIconOnly
                          icon={<Icon icon={TrashIcon} size="sm" />}
                          onClick={(event) => {
                            event.stopPropagation();
                            setPendingDelete({
                              kind: 'capture',
                              id: item.id,
                              label: item.window.title,
                            });
                          }}
                        />
                      </HStack>
                    }
                  />
                ))}
              </List>
            ))}

          {view === 'search' && (
            <VStack gap={2}>
              <TextInput
                label="Search local memory"
                value={search}
                onChange={setSearch}
                placeholder="Search OCR and messages…"
                startIcon={MagnifyingGlassIcon}
                hasClear
                isLabelHidden
              />
              {search.trim().length <= 1 ? (
                <Text type="supporting" color="secondary">
                  Enter at least two characters.
                </Text>
              ) : searchQuery.isPending ? (
                <Text type="supporting" color="secondary">
                  Searching…
                </Text>
              ) : searchQuery.isError ? (
                <Text type="supporting" color="secondary">
                  Search is temporarily unavailable.
                </Text>
              ) : hits.length === 0 ? (
                <EmptyState
                  title="No matches"
                  description="Try a different search term."
                  isCompact
                />
              ) : (
                <List density="compact" hasDividers>
                  {hits.map((hit) => (
                    <ListItem
                      key={`${hit.kind}:${hit.refId}`}
                      label={hit.sourceTitle}
                      description={hit.snippet}
                      startContent={
                        <Icon
                          icon={
                            hit.kind === 'message'
                              ? ChatBubbleLeftRightIcon
                              : PhotoIcon
                          }
                          size="sm"
                        />
                      }
                      endContent={
                        <Timestamp value={hit.createdAt} format="auto" />
                      }
                      onClick={() =>
                        void openSearchHit(hit.kind, hit.ownerId)
                      }
                    />
                  ))}
                </List>
              )}
            </VStack>
          )}

          {error != null && (
            <Text type="supporting" color="secondary">
              {error}
            </Text>
          )}
        </VStack>
      </Section>
      <AlertDialog
        isOpen={pendingDelete != null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPendingDelete(null);
        }}
        title={`Delete ${pendingDelete?.kind ?? 'item'}?`}
        description={`“${pendingDelete?.label ?? ''}” will be permanently removed from this device.`}
        actionLabel="Delete"
        isActionLoading={deleting}
        onAction={() => void deleteSelected()}
      />
    </Dialog>
  );
}
