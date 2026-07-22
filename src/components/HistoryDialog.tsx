import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { List, ListItem } from '@astryxdesign/core/List';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Section } from '@astryxdesign/core/Section';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import {
  ChatBubbleLeftRightIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

import { ipc } from '../lib/ipc';
import { useAppStore } from '../state/appStore';

// Conversation history: switch between past conversations, start a new one,
// or delete conversations that are no longer needed.
export function HistoryDialog() {
  const queryClient = useQueryClient();
  const historyOpen = useAppStore((s) => s.historyOpen);
  const setHistoryOpen = useAppStore((s) => s.setHistoryOpen);
  const conversationId = useAppStore((s) => s.conversationId);
  const setConversationId = useAppStore((s) => s.setConversationId);
  const setComposerValue = useAppStore((s) => s.setComposerValue);
  const setExpanded = useAppStore((s) => s.setExpanded);

  const conversationsQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: () => ipc.listConversations(),
    enabled: historyOpen,
  });

  const openConversation = (id: string) => {
    setConversationId(id);
    setExpanded(true);
    setHistoryOpen(false);
  };

  const newConversation = () => {
    setConversationId(null);
    setComposerValue('');
    setHistoryOpen(false);
  };

  const deleteConversation = async (id: string) => {
    await ipc.deleteConversation(id);
    if (conversationId === id) setConversationId(null);
    await queryClient.invalidateQueries({ queryKey: ['conversations'] });
  };

  const conversations = conversationsQuery.data ?? [];

  return (
    <Dialog isOpen={historyOpen} onOpenChange={setHistoryOpen} purpose="info" width={420}>
      <DialogHeader
        title="Conversation history"
        subtitle="Switch between chats or start a new one"
        onOpenChange={setHistoryOpen}
      />
      <Section variant="transparent">
        <Button
          label="New chat"
          variant="secondary"
          size="sm"
          icon={<Icon icon={PlusIcon} size="sm" />}
          onClick={newConversation}
        />
        {conversations.length === 0 ? (
          <EmptyState
            title="No conversations yet"
            description="Start a chat to see it appear here."
            icon={<Icon icon={ChatBubbleLeftRightIcon} size="lg" />}
            isCompact
          />
        ) : (
          <List density="compact" hasDividers>
            {conversations.map((c) => (
              <ListItem
                key={c.id}
                label={c.title}
                isSelected={c.id === conversationId}
                description={<Timestamp value={c.updatedAt} format="auto" />}
                startContent={<Icon icon={ChatBubbleLeftRightIcon} size="sm" />}
                onClick={() => openConversation(c.id)}
                endContent={
                  <Button
                    label="Delete"
                    variant="ghost"
                    size="sm"
                    isIconOnly
                    icon={<Icon icon={TrashIcon} size="sm" />}
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteConversation(c.id);
                    }}
                  />
                }
              />
            ))}
          </List>
        )}
      </Section>
    </Dialog>
  );
}
