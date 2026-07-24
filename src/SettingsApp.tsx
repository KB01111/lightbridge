import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { check } from '@tauri-apps/plugin-updater';

import { AppShell } from '@astryxdesign/core/AppShell';
import {
  SideNav,
  SideNavHeading,
  SideNavItem,
  SideNavSection,
} from '@astryxdesign/core/SideNav';
import { Toolbar } from '@astryxdesign/core/Toolbar';
import { VStack, HStack, StackItem } from '@astryxdesign/core/Layout';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Section as AstryxSection } from '@astryxdesign/core/Section';
import { List, ListItem } from '@astryxdesign/core/List';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Token } from '@astryxdesign/core/Token';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Slider } from '@astryxdesign/core/Slider';
import { Banner } from '@astryxdesign/core/Banner';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import {
  AdjustmentsHorizontalIcon,
  ArrowDownTrayIcon,
  BoltIcon,
  CircleStackIcon,
  CloudIcon,
  CpuChipIcon,
  InformationCircleIcon,
  PaintBrushIcon,
  ShieldCheckIcon,
  Squares2X2Icon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

import {
  events,
  ipc,
  type AppSettings,
  type GatewayInstallProgress,
  type ModelRoute,
  type OverlayPreferences,
  type ProviderConnection,
} from './lib/ipc';
import { useSurfaceReady } from './lib/useSurfaceReady';

type SettingsPage =
  | 'overview'
  | 'providers'
  | 'models'
  | 'overlay'
  | 'appearance'
  | 'privacy'
  | 'data'
  | 'about';

const RETENTION_OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: '0', label: 'Keep until deleted' },
];

const MODE_OPTIONS = [
  { value: 'system', label: 'Use Windows setting' },
  { value: 'dark', label: 'Graphite Aurora' },
  { value: 'light', label: 'Aurora Light' },
];

const GATEWAY_MODE_OPTIONS = [
  { value: 'managed', label: 'Managed on this device' },
  { value: 'external', label: 'External Bifrost gateway' },
];

const AUTH_OPTIONS = [
  { value: 'none', label: 'No authentication' },
  { value: 'bearer', label: 'Bearer token' },
  { value: 'basic', label: 'Basic username:password' },
];

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
  variant?: 'surface';
}) {
  return (
    <AstryxSection variant="section">
      <VStack gap={3}>
        <Heading level={3}>{title}</Heading>
        {children}
      </VStack>
    </AstryxSection>
  );
}

export default function SettingsApp() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState<SettingsPage>('overview');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [installProgress, setInstallProgress] =
    useState<GatewayInstallProgress | null>(null);

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: ipc.getSettings,
  });
  const gatewayQuery = useQuery({
    queryKey: ['gatewayStatus'],
    queryFn: ipc.getGatewayStatus,
    refetchInterval: 15_000,
  });
  const providersQuery = useQuery({
    queryKey: ['providerConnections'],
    queryFn: ipc.listProviderConnections,
  });
  useSurfaceReady(
    'settings',
    settingsQuery.isFetched &&
      gatewayQuery.isFetched &&
      providersQuery.isFetched,
  );

  useEffect(() => {
    const progressListener = events.onGatewayInstallProgress(setInstallProgress);
    const statusListener = events.onGatewayStatus((status) => {
      queryClient.setQueryData(['gatewayStatus'], status);
    });
    return () => {
      void progressListener.then((unlisten) => unlisten());
      void statusListener.then((unlisten) => unlisten());
    };
  }, [queryClient]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['settings'] }),
      queryClient.invalidateQueries({ queryKey: ['gatewayStatus'] }),
      queryClient.invalidateQueries({ queryKey: ['providerConnections'] }),
      queryClient.invalidateQueries({ queryKey: ['models'] }),
    ]);
    await ipc.notifySettingsChanged();
  };

  const saveSettings = (settings: AppSettings) => {
    queryClient.setQueryData(['settings'], settings);
    void ipc.notifySettingsChanged();
  };

  const nav = (
    <SideNav
      header={
        <SideNavHeading
          heading="LightBridge"
          superheading="Settings"
          subheading="Graphite Aurora"
          icon={<Icon icon={BoltIcon} size="md" />}
          headerEndContent={
            <StatusDot
              variant={gatewayQuery.data?.healthy ? 'success' : 'warning'}
              label={gatewayQuery.data?.healthy ? 'Gateway ready' : 'Gateway attention'}
            />
          }
        />
      }>
      <SideNavSection title="LightBridge">
        <SideNavItem
          label="Overview"
          icon={Squares2X2Icon}
          isSelected={page === 'overview'}
          onClick={() => setPage('overview')}
        />
        <SideNavItem
          label="Providers"
          icon={CloudIcon}
          isSelected={page === 'providers'}
          onClick={() => setPage('providers')}
        />
        <SideNavItem
          label="Models and routes"
          icon={CpuChipIcon}
          isSelected={page === 'models'}
          onClick={() => setPage('models')}
        />
      </SideNavSection>
      <SideNavSection title="Experience">
        <SideNavItem
          label="Overlay"
          icon={AdjustmentsHorizontalIcon}
          isSelected={page === 'overlay'}
          onClick={() => setPage('overlay')}
        />
        <SideNavItem
          label="Appearance"
          icon={PaintBrushIcon}
          isSelected={page === 'appearance'}
          onClick={() => setPage('appearance')}
        />
        <SideNavItem
          label="Capture and privacy"
          icon={ShieldCheckIcon}
          isSelected={page === 'privacy'}
          onClick={() => setPage('privacy')}
        />
      </SideNavSection>
      <SideNavSection title="Application">
        <SideNavItem
          label="Data and updates"
          icon={CircleStackIcon}
          isSelected={page === 'data'}
          onClick={() => setPage('data')}
        />
        <SideNavItem
          label="About"
          icon={InformationCircleIcon}
          isSelected={page === 'about'}
          onClick={() => setPage('about')}
        />
      </SideNavSection>
    </SideNav>
  );

  return (
    <AppShell
      height="fill"
      variant="elevated"
      sideNav={nav}
      mobileNav={false}
      contentPadding={0}>
      <VStack style={{ height: '100%', minHeight: 0 }}>
        <Toolbar
          label="Settings window"
          dividers={['bottom']}
          startContent={
            <VStack gap={0}>
              <Heading level={2}>{pageTitle(page)}</Heading>
              <Text type="supporting" color="secondary">
                {pageDescription(page)}
              </Text>
            </VStack>
          }
          endContent={
            <Button
              label="Close settings"
              variant="ghost"
              isIconOnly
              icon={<Icon icon={XMarkIcon} size="sm" />}
              onClick={() => void getCurrentWindow().hide()}
            />
          }
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest('button') == null) {
              void getCurrentWindow().startDragging();
            }
          }}
        />
        <StackItem size="fill" style={{ minHeight: 0, overflow: 'auto' }}>
          <VStack gap={5} style={{ padding: 'var(--spacing-6)' }}>
            {installProgress != null && installProgress.phase !== 'complete' && (
              <Banner
                status="info"
                title={installProgress.message}
                description={`${installProgress.percent}% · ${formatBytes(installProgress.downloadedBytes)} of ${formatBytes(installProgress.totalBytes)}`}
              />
            )}
            {notice != null && (
              <Banner
                status={notice.startsWith('Could not') || notice.startsWith('Failed') ? 'error' : 'success'}
                title={notice}
                onDismiss={() => setNotice(null)}
              />
            )}
            {page === 'overview' && (
              <OverviewPanel
                settings={settingsQuery.data}
                gateway={gatewayQuery.data}
                providers={providersQuery.data ?? []}
                onNavigate={setPage}
              />
            )}
            {page === 'providers' && (
              <ProvidersPanel
                settings={settingsQuery.data}
                providers={providersQuery.data ?? []}
                gatewayHealthy={gatewayQuery.data?.healthy === true}
                busy={busy}
                setBusy={setBusy}
                setNotice={setNotice}
                refresh={refresh}
              />
            )}
            {page === 'models' && (
              <ModelsPanel
                settings={settingsQuery.data}
                gatewayHealthy={gatewayQuery.data?.healthy === true}
                setNotice={setNotice}
                saveSettings={saveSettings}
              />
            )}
            {page === 'overlay' && settingsQuery.data != null && (
              <OverlayPanel
                settings={settingsQuery.data}
                setNotice={setNotice}
                saveSettings={saveSettings}
              />
            )}
            {page === 'appearance' && settingsQuery.data != null && (
              <AppearancePanel
                settings={settingsQuery.data}
                setNotice={setNotice}
                saveSettings={saveSettings}
              />
            )}
            {page === 'privacy' && settingsQuery.data != null && (
              <PrivacyPanel
                settings={settingsQuery.data}
                setNotice={setNotice}
                saveSettings={saveSettings}
              />
            )}
            {page === 'data' && (
              <DataPanel
                busy={busy}
                setBusy={setBusy}
                setNotice={setNotice}
                refresh={refresh}
              />
            )}
            {page === 'about' && <AboutPanel gatewayVersion={gatewayQuery.data?.version} />}
          </VStack>
        </StackItem>
      </VStack>
    </AppShell>
  );
}

function OverviewPanel({
  settings,
  gateway,
  providers,
  onNavigate,
}: {
  settings?: AppSettings;
  gateway?: Awaited<ReturnType<typeof ipc.getGatewayStatus>>;
  providers: ProviderConnection[];
  onNavigate: (page: SettingsPage) => void;
}) {
  const connected = providers.filter((provider) => provider.isConfigured);
  return (
    <VStack gap={5}>
      <Section title="System status" variant="surface">
        <List hasDividers>
          <ListItem
            label="Bifrost AI gateway"
            description={gateway?.message ?? 'Checking gateway health…'}
            startContent={
              <StatusDot
                variant={gateway?.healthy ? 'success' : 'warning'}
                label={gateway?.healthy ? 'Ready' : 'Attention'}
              />
            }
            endContent={
              <Token
                label={gateway?.mode === 'external' ? 'External' : 'Managed'}
                color="purple"
              />
            }
          />
          <ListItem
            label="Connected providers"
            description={
              connected.length > 0
                ? connected.map((provider) => provider.provider.label).join(', ')
                : 'No provider connected yet'
            }
            endContent={
              <Button
                label="Manage"
                variant="ghost"
                size="sm"
                onClick={() => onNavigate('providers')}
              />
            }
          />
          <ListItem
            label="Default route"
            description={
              settings?.modelRoutes.find(
                (route) => route.id === settings.aiProfile,
              )?.model ?? 'Best'
            }
            endContent={
              <Button
                label="Configure"
                variant="ghost"
                size="sm"
                onClick={() => onNavigate('models')}
              />
            }
          />
        </List>
      </Section>
      {!gateway?.healthy && (
        <Banner
          status="warning"
          title="AI setup needs attention"
          description="Connect a provider and LightBridge will download, verify, and start Bifrost automatically."
          endContent={
            <Button
              label="Connect provider"
              variant="primary"
              size="sm"
              onClick={() => onNavigate('providers')}
            />
          }
        />
      )}
      <Section title="Privacy at a glance" variant="surface">
        <VStack gap={2}>
          <Text>
            Screenshots and OCR remain local until you press Send. Provider
            credentials never enter React, SQLite, exports, or diagnostics.
          </Text>
          <HStack gap={1} wrap="wrap">
            <Token label="Windows Credential Manager" color="green" />
            <Token label="Loopback-only gateway" color="blue" />
            <Token label="Encrypted Bifrost config" color="purple" />
          </HStack>
        </VStack>
      </Section>
    </VStack>
  );
}

function ProvidersPanel({
  settings,
  providers,
  gatewayHealthy,
  busy,
  setBusy,
  setNotice,
  refresh,
}: {
  settings?: AppSettings;
  providers: ProviderConnection[];
  gatewayHealthy: boolean;
  busy: boolean;
  setBusy: (value: boolean) => void;
  setNotice: (value: string | null) => void;
  refresh: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState('openai');
  const [credential, setCredential] = useState('');
  const [gatewayMode, setGatewayMode] =
    useState<AppSettings['gatewayMode']>('managed');
  const [externalUrl, setExternalUrl] = useState('');
  const [externalAuthMode, setExternalAuthMode] =
    useState<AppSettings['externalGatewayAuth']>('none');
  const [externalAuth, setExternalAuth] = useState('');
  const [customProviderId, setCustomProviderId] = useState('');
  const selected = providers.find(
    (provider) => provider.provider.id === selectedId,
  );

  useEffect(() => {
    setGatewayMode(settings?.gatewayMode ?? 'managed');
    setExternalUrl(settings?.externalGatewayUrl ?? '');
    setExternalAuthMode(settings?.externalGatewayAuth ?? 'none');
  }, [
    settings?.externalGatewayAuth,
    settings?.externalGatewayUrl,
    settings?.gatewayMode,
  ]);

  const connect = async (providerId = selectedId) => {
    setBusy(true);
    setNotice(null);
    try {
      await ipc.setProviderCredential(providerId, credential);
      setCredential('');
      setNotice(`${providerLabel(providerId, providers)} is connected through Bifrost.`);
      await refresh();
    } catch (error) {
      setNotice(`Could not connect ${providerLabel(providerId, providers)}: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <VStack gap={5}>
      <Section title="Gateway delivery" variant="surface">
        <VStack gap={3}>
          <Selector
            label="Bifrost gateway"
            description="Managed mode keeps the gateway private to this Windows account."
            value={gatewayMode}
            options={GATEWAY_MODE_OPTIONS}
            onChange={(mode) => {
              const nextMode = mode as AppSettings['gatewayMode'];
              setGatewayMode(nextMode);
              if (nextMode === 'managed') {
                setBusy(true);
                void ipc
                  .setGatewayConfig({
                    mode: 'managed',
                    externalUrl: null,
                    authMode: 'none',
                    authSecret: null,
                  })
                  .then(refresh)
                  .catch((error) => setNotice(String(error)))
                  .finally(() => setBusy(false));
              }
            }}
          />
          {gatewayMode === 'external' && (
            <VStack gap={2}>
              <TextInput
                label="External gateway URL"
                value={externalUrl}
                onChange={setExternalUrl}
                placeholder="https://bifrost.example.com"
              />
              <Selector
                label="Authentication"
                value={externalAuthMode}
                options={AUTH_OPTIONS}
                onChange={(value) =>
                  setExternalAuthMode(
                    value as AppSettings['externalGatewayAuth'],
                  )
                }
              />
              {externalAuthMode !== 'none' && (
                <TextInput
                  label={
                    externalAuthMode === 'basic'
                      ? 'Username:password'
                      : 'Bearer token'
                  }
                  type="password"
                  value={externalAuth}
                  onChange={setExternalAuth}
                  placeholder={
                    externalAuthMode === 'basic'
                      ? 'username:password'
                      : 'Gateway token'
                  }
                />
              )}
              <Button
                label="Apply external gateway"
                variant="primary"
                isDisabled={busy || externalUrl.trim().length === 0}
                onClick={() => {
                  setBusy(true);
                  void ipc
                    .setGatewayConfig({
                      mode: 'external',
                      externalUrl: externalUrl.trim(),
                      authMode: externalAuthMode,
                      authSecret: externalAuth.trim() || null,
                    })
                    .then(refresh)
                    .catch((error) => setNotice(String(error)))
                    .finally(() => setBusy(false));
                }}
              />
            </VStack>
          )}
        </VStack>
      </Section>

      <Section title="Provider connections" variant="surface">
        <VStack gap={4}>
          <List hasDividers>
            {providers
              .filter((provider) => provider.provider.isCurated)
              .map((provider) => (
                <ListItem
                  key={provider.provider.id}
                  label={provider.provider.label}
                  description={provider.provider.description}
                  isSelected={selectedId === provider.provider.id}
                  onClick={() => {
                    setSelectedId(provider.provider.id);
                    setCredential(provider.baseUrl ?? '');
                  }}
                  startContent={
                    <StatusDot
                      variant={provider.isConfigured ? 'success' : 'neutral'}
                      label={
                        provider.isConfigured ? 'Connected' : 'Not configured'
                      }
                    />
                  }
                  endContent={
                    <Token
                      label={provider.provider.isLocal ? 'Local' : 'Cloud'}
                      color={provider.provider.isLocal ? 'green' : 'blue'}
                    />
                  }
                />
              ))}
          </List>
          {selected != null && (
            <VStack gap={2}>
              <Heading level={3}>{selected.provider.label}</Heading>
              <TextInput
                label={selected.provider.credentialLabel}
                description={
                  selected.provider.isLocal
                    ? 'The local Ollama endpoint is not treated as a secret.'
                    : 'The saved credential is never returned to this field.'
                }
                type={selected.provider.isLocal ? 'text' : 'password'}
                value={credential}
                onChange={setCredential}
                placeholder={selected.provider.credentialPlaceholder}
              />
              <HStack gap={2}>
                <Button
                  label={selected.isConfigured ? 'Reconnect' : 'Connect'}
                  variant="primary"
                  isLoading={busy}
                  isDisabled={
                    busy ||
                    (!selected.provider.isLocal &&
                      credential.trim().length === 0)
                  }
                  onClick={() => void connect()}
                />
                {selected.isConfigured && (
                  <Button
                    label="Remove"
                    variant="destructive"
                    isDisabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void ipc
                        .removeProvider(selected.provider.id)
                        .then(async () => {
                          setNotice(`${selected.provider.label} was removed.`);
                          await refresh();
                        })
                        .catch((error) => setNotice(String(error)))
                        .finally(() => setBusy(false));
                    }}
                  />
                )}
              </HStack>
            </VStack>
          )}
        </VStack>
      </Section>

      <Section title="Advanced Bifrost provider" variant="surface">
        <VStack gap={2}>
          <Text type="supporting" color="secondary">
            Add another provider identifier supported by the installed Bifrost
            catalog. Models become searchable on the Models page.
          </Text>
          <HStack gap={2}>
            <TextInput
              label="Provider identifier"
              isLabelHidden
              value={customProviderId}
              onChange={setCustomProviderId}
              placeholder="Provider ID"
            />
            <Button
              label="Use provider"
              variant="secondary"
              isDisabled={customProviderId.trim().length === 0}
              onClick={() => {
                setSelectedId(customProviderId.trim().toLowerCase());
                setCustomProviderId('');
              }}
            />
          </HStack>
          {selected != null || selectedId === 'openai' ? null : (
            <VStack gap={2}>
              <TextInput
                label={`Credential for ${selectedId}`}
                type="password"
                value={credential}
                onChange={setCredential}
                placeholder="Provider credential"
              />
              <Button
                label="Connect advanced provider"
                variant="primary"
                isDisabled={busy || credential.trim().length === 0}
                onClick={() => void connect(selectedId)}
              />
            </VStack>
          )}
        </VStack>
      </Section>

      <Text type="supporting" color="secondary">
        Gateway health: {gatewayHealthy ? 'Ready' : 'Needs attention'}
      </Text>
    </VStack>
  );
}

function ModelsPanel({
  settings,
  gatewayHealthy,
  setNotice,
  saveSettings,
}: {
  settings?: AppSettings;
  gatewayHealthy: boolean;
  setNotice: (value: string | null) => void;
  saveSettings: (settings: AppSettings) => void;
}) {
  const modelsQuery = useQuery({
    queryKey: ['models'],
    queryFn: ipc.listModels,
    enabled: gatewayHealthy,
  });
  const options = useMemo(() => {
    const discovered = (modelsQuery.data ?? []).map((model) => ({
      value: model.id,
      label: `${providerLabel(model.provider, [])} · ${model.label}`,
    }));
    for (const route of settings?.modelRoutes ?? []) {
      if (!discovered.some((option) => option.value === route.model)) {
        discovered.push({ value: route.model, label: route.model });
      }
    }
    return discovered;
  }, [modelsQuery.data, settings?.modelRoutes]);

  const updateRoute = (routeId: string, patch: Partial<ModelRoute>) => {
    if (settings == null) return;
    const routes = settings.modelRoutes.map((route) =>
      route.id === routeId ? { ...route, ...patch } : route,
    );
    void ipc
      .setModelRoutes(routes)
      .then(saveSettings)
      .then(() => setNotice('Model routes saved.'))
      .catch((error) => setNotice(`Could not save routes: ${String(error)}`));
  };

  return (
    <VStack gap={5}>
      {!gatewayHealthy && (
        <Banner
          status="warning"
          title="Connect a provider to discover models"
          description="Existing route values remain editable and are preserved."
        />
      )}
      <Section title="Answer routes" variant="surface">
        <VStack gap={5}>
          {(settings?.modelRoutes ?? []).map((route) => (
            <VStack key={route.id} gap={2}>
              <HStack gap={2} vAlign="center">
                <Heading level={3}>{route.label}</Heading>
                <Token label={route.id} color="purple" />
              </HStack>
              <Selector
                label="Primary model"
                value={route.model}
                options={options}
                hasSearch
                isDisabled={options.length === 0}
                onChange={(model) => updateRoute(route.id, { model })}
              />
              <Selector
                label="Reasoning effort"
                value={route.reasoningEffort}
                options={[
                  { value: 'none', label: 'Provider default' },
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                ]}
                onChange={(reasoningEffort) =>
                  updateRoute(route.id, {
                    reasoningEffort:
                      reasoningEffort as ModelRoute['reasoningEffort'],
                  })
                }
              />
            </VStack>
          ))}
        </VStack>
      </Section>
      <Section title="Default route" variant="surface">
        <Selector
          label="New conversations use"
          value={settings?.aiProfile ?? 'best'}
          options={(settings?.modelRoutes ?? []).map((route) => ({
            value: route.id,
            label: `${route.label} · ${route.model}`,
          }))}
          onChange={(routeId) => {
            void ipc
              .setAiProfile(routeId)
              .then(saveSettings)
              .catch((error) => setNotice(String(error)));
          }}
        />
      </Section>
    </VStack>
  );
}

function OverlayPanel({
  settings,
  setNotice,
  saveSettings,
}: {
  settings: AppSettings;
  setNotice: (value: string | null) => void;
  saveSettings: (settings: AppSettings) => void;
}) {
  const [opacity, setOpacity] = useState(settings.overlay.opacity);
  const [shortcut, setShortcut] = useState(settings.shortcut);
  const update = (patch: Partial<OverlayPreferences>) => {
    const preferences = { ...settings.overlay, ...patch };
    void ipc
      .setOverlayPreferences(preferences)
      .then(saveSettings)
      .catch((error) => setNotice(String(error)));
  };
  return (
    <VStack gap={5}>
      <Section title="Overlay behavior" variant="surface">
        <VStack gap={4}>
          <Slider
            label="Panel transparency"
            description="Text and controls remain fully opaque."
            min={72}
            max={100}
            value={opacity}
            formatValue={(value) => `${value}%`}
            valueDisplay="text"
            onChange={setOpacity}
            onChangeEnd={(value: number) => update({ opacity: value })}
          />
          <Switch
            label="Keep overlay above other windows"
            description="The status orb always remains above other windows."
            value={settings.overlay.alwaysOnTop}
            onChange={(value) => update({ alwaysOnTop: value })}
          />
          <Switch
            label="Show the status orb"
            description="The tray and global shortcut remain available when hidden."
            value={settings.overlay.orbEnabled}
            onChange={(value) => update({ orbEnabled: value })}
          />
          <Switch
            label="Pause capture and AI"
            description="The overlay remains available while requests are paused."
            value={settings.overlay.paused}
            onChange={(value) => update({ paused: value })}
          />
        </VStack>
      </Section>
      <Section title="Global shortcut" variant="surface">
        <VStack gap={2}>
          <TextInput
            label="Capture and open LightBridge"
            value={shortcut}
            onChange={setShortcut}
            placeholder="Ctrl+Shift+Space"
          />
          <Button
            label="Apply shortcut"
            variant="secondary"
            isDisabled={
              shortcut.trim().length === 0 || shortcut === settings.shortcut
            }
            onClick={() => {
              void ipc
                .setShortcut(shortcut)
                .then(saveSettings)
                .then(() => setNotice('Global shortcut updated.'))
                .catch((error) => {
                  setShortcut(settings.shortcut);
                  setNotice(String(error));
                });
            }}
          />
        </VStack>
      </Section>
    </VStack>
  );
}

function AppearancePanel({
  settings,
  setNotice,
  saveSettings,
}: {
  settings: AppSettings;
  setNotice: (value: string | null) => void;
  saveSettings: (settings: AppSettings) => void;
}) {
  const update = (
    patch: Partial<AppSettings['appearance']>,
  ) => {
    const preferences = { ...settings.appearance, ...patch };
    void ipc
      .setAppearancePreferences(preferences)
      .then(saveSettings)
      .then(() => setNotice('Appearance updated.'))
      .catch((error) => setNotice(String(error)));
  };
  return (
    <VStack gap={5}>
      <Section title="Graphite Aurora" variant="surface">
        <VStack gap={4}>
          <Selector
            label="Color mode"
            value={settings.appearance.mode}
            options={MODE_OPTIONS}
            onChange={(mode) =>
              update({ mode: mode as AppSettings['appearance']['mode'] })
            }
          />
          <Switch
            label="Reduce interface motion"
            description="Disables pulsing and transition effects where possible."
            value={settings.appearance.reducedMotion}
            onChange={(reducedMotion) => update({ reducedMotion })}
          />
          <HStack gap={1} wrap="wrap">
            <Token label="Graphite surfaces" color="gray" />
            <Token label="Aurora violet" color="purple" />
            <Token label="High-contrast text" color="blue" />
          </HStack>
        </VStack>
      </Section>
      <Banner
        status="info"
        title="Windows accessibility is respected"
        description="Forced colors disable transparency, and reduced-motion preferences suppress nonessential animation."
      />
    </VStack>
  );
}

function PrivacyPanel({
  settings,
  setNotice,
  saveSettings,
}: {
  settings: AppSettings;
  setNotice: (value: string | null) => void;
  saveSettings: (settings: AppSettings) => void;
}) {
  return (
    <VStack gap={5}>
      <Section title="Capture boundary" variant="surface">
        <List hasDividers>
          <ListItem
            label="Screenshots"
            description="Stored locally and included only while their context token is selected."
            startContent={<StatusDot variant="success" label="Protected" />}
          />
          <ListItem
            label="On-screen text"
            description="OCR runs on Windows and remains local until Send."
            startContent={<StatusDot variant="success" label="Protected" />}
          />
          <ListItem
            label="Provider credentials"
            description="Stored in Windows Credential Manager and passed only to Bifrost."
            startContent={<StatusDot variant="success" label="Protected" />}
          />
        </List>
      </Section>
      <Section title="Retention" variant="surface">
        <Selector
          label="Delete captures after"
          value={String(settings.captureRetentionDays)}
          options={RETENTION_OPTIONS}
          onChange={(value) => {
            void ipc
              .setCaptureRetention(Number(value))
              .then(saveSettings)
              .then(() => setNotice('Capture retention updated.'))
              .catch((error) => setNotice(String(error)));
          }}
        />
      </Section>
    </VStack>
  );
}

function DataPanel({
  busy,
  setBusy,
  setNotice,
  refresh,
}: {
  busy: boolean;
  setBusy: (value: boolean) => void;
  setNotice: (value: string | null) => void;
  refresh: () => Promise<void>;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const action = async (operation: () => Promise<string>, success: string) => {
    setBusy(true);
    try {
      const result = await operation();
      setNotice(result.length > 0 ? `${success} ${result}` : success);
    } catch (error) {
      setNotice(`Failed: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <VStack gap={5}>
      <Section title="Exports" variant="surface">
        <VStack gap={3}>
          <Text type="supporting" color="secondary">
            Full exports contain your local conversations and capture metadata.
            Diagnostics are redacted.
          </Text>
          <HStack gap={2} wrap="wrap">
            <Button
              label="Export my data"
              variant="secondary"
              icon={<Icon icon={ArrowDownTrayIcon} size="sm" />}
              isDisabled={busy}
              onClick={() =>
                void action(ipc.exportData, 'Data exported to')
              }
            />
            <Button
              label="Export diagnostics"
              variant="secondary"
              isDisabled={busy}
              onClick={() =>
                void action(ipc.exportDiagnostics, 'Diagnostics exported to')
              }
            />
          </HStack>
        </VStack>
      </Section>
      <Section title="Application updates" variant="surface">
        <Button
          label="Check for updates"
          variant="secondary"
          isDisabled={busy}
          onClick={() => {
            setBusy(true);
            setNotice('Checking for updates…');
            void check()
              .then(async (update) => {
                if (update == null || !update.available) {
                  setNotice('LightBridge is up to date.');
                  return;
                }
                setNotice(`Downloading LightBridge ${update.version}…`);
                await update.downloadAndInstall();
                setNotice('Update installed. Restart LightBridge to finish.');
              })
              .catch((error) => setNotice(`Update check failed: ${String(error)}`))
              .finally(() => setBusy(false));
          }}
        />
      </Section>
      <Section title="Delete local data" variant="surface">
        <VStack gap={2}>
          <Text type="supporting" color="secondary">
            Removes conversations, messages, captures, and OCR. Provider
            credentials and settings remain.
          </Text>
          <Button
            label="Delete all local data"
            variant="destructive"
            icon={<Icon icon={TrashIcon} size="sm" />}
            isDisabled={busy}
            onClick={() => setConfirmDelete(true)}
          />
        </VStack>
      </Section>
      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete all local data?"
        description="Conversations, messages, captures, and OCR on this device will be permanently removed."
        actionLabel="Delete all data"
        onAction={() => {
          setBusy(true);
          void ipc
            .deleteAllData()
            .then(refresh)
            .then(() => setNotice('All local conversation and capture data was deleted.'))
            .catch((error) => setNotice(`Deletion failed: ${String(error)}`))
            .finally(() => {
              setBusy(false);
              setConfirmDelete(false);
            });
        }}
      />
    </VStack>
  );
}

function AboutPanel({ gatewayVersion }: { gatewayVersion?: string | null }) {
  return (
    <VStack gap={5}>
      <Section title="LightBridge" variant="surface">
        <VStack gap={2}>
          <Heading level={2}>Private context, useful answers.</Heading>
          <Text>
            A Windows-first AI overlay built with Tauri, React, Astryx, and the
            Maxim Bifrost gateway.
          </Text>
          <HStack gap={1} wrap="wrap">
            <Token label="LightBridge 0.2.0-rc.1" color="purple" />
            <Token
              label={`Bifrost ${gatewayVersion ?? 'external'}`}
              color="blue"
            />
            <Token label="Windows x86-64" color="gray" />
          </HStack>
        </VStack>
      </Section>
      <Section title="Security posture" variant="surface">
        <Text type="supporting" color="secondary">
          Managed Bifrost is checksum-pinned, bound to loopback, protected by a
          generated virtual key, and stopped when LightBridge exits.
        </Text>
      </Section>
    </VStack>
  );
}

function pageTitle(page: SettingsPage) {
  return {
    overview: 'Overview',
    providers: 'Providers',
    models: 'Models and routes',
    overlay: 'Overlay',
    appearance: 'Appearance',
    privacy: 'Capture and privacy',
    data: 'Data and updates',
    about: 'About LightBridge',
  }[page];
}

function pageDescription(page: SettingsPage) {
  return {
    overview: 'Gateway health, providers, and privacy at a glance',
    providers: 'Connect cloud and local models through Bifrost',
    models: 'Choose primary models for Best, Balanced, and Fast',
    overlay: 'Transparency, orb behavior, and shortcut',
    appearance: 'Graphite Aurora color and motion',
    privacy: 'Control what is captured, sent, and retained',
    data: 'Exports, updates, diagnostics, and deletion',
    about: 'Versions and security posture',
  }[page];
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function providerLabel(
  providerId: string,
  providers: ProviderConnection[],
) {
  return (
    providers.find((provider) => provider.provider.id === providerId)?.provider
      .label ??
    providerId
      .split(/[-_]/)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(' ')
  );
}
