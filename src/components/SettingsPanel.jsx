import React, { useEffect, useState } from 'react';
import StatusMessage from './ui/StatusMessage';
import { updateAiSettings } from '../lib/api.mjs';

const PROVIDERS = [
    ['google', 'Google'],
    ['openai', 'OpenAI'],
    ['openrouter', 'OpenRouter'],
    ['custom', 'Custom'],
];

const ROUTES = [
    ['planner', 'Story Planner', 'text'],
    ['storyboard', 'Storyboard JSON', 'text'],
    ['pageImage', 'Page Images', 'image'],
    ['panelImage', 'Panel Images', 'image'],
    ['imageEdit', 'Image Editing', 'image'],
];

const DEFAULT_OPTIONS = {
    artStyle: ['storybook_classic', 'watercolor', 'oil_painting', 'digital_illustration', 'anime', 'realistic'],
    aspectRatio: ['portrait', 'landscape', 'square', '3:4', 'cinematic'],
    colorMode: ['bw', 'color'],
    genMode: ['storyboard', 'full'],
    textDensity: ['minimal', 'dialog', 'dialog_fx', 'dialog_fx_narration', 'full'],
};

const SettingsPanel = ({ isOpen, onClose, onNotify, onSaved, settings }) => {
    const [activeProvider, setActiveProvider] = useState('google');
    const [draft, setDraft] = useState(settings);
    const [secrets, setSecrets] = useState({});
    const [statusMessage, setStatusMessage] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setDraft(settings);
        setSecrets({});
        setStatusMessage('');
    }, [settings, isOpen]);

    if (!isOpen || !draft?.providers) return null;

    const provider = draft.providers[activeProvider];

    const updateProvider = (providerKey, patch) => {
        setDraft((previous) => ({
            ...previous,
            providers: {
                ...previous.providers,
                [providerKey]: {
                    ...previous.providers[providerKey],
                    ...patch,
                    capabilities: {
                        ...previous.providers[providerKey].capabilities,
                        ...(patch.capabilities || {}),
                    },
                },
            },
        }));
    };

    const updateRoute = (routeKey, patch) => {
        setDraft((previous) => ({
            ...previous,
            routes: {
                ...previous.routes,
                [routeKey]: {
                    ...previous.routes[routeKey],
                    ...patch,
                },
            },
        }));
    };

    const updateDefault = (key, value) => {
        setDraft((previous) => ({
            ...previous,
            defaults: { ...previous.defaults, [key]: value },
        }));
    };

    const updateRoutePricing = (routeKey, key, value) => {
        setDraft((previous) => ({
            ...previous,
            pricing: {
                ...previous.pricing,
                routes: {
                    ...previous.pricing.routes,
                    [routeKey]: {
                        ...previous.pricing.routes[routeKey],
                        [key]: value,
                    },
                },
            },
        }));
    };

    const routeProviderSupports = (providerKey, routeType) => {
        const candidate = draft.providers[providerKey];
        if (!candidate?.enabled) return false;
        return routeType === 'image' ? candidate.capabilities.imageOutput : candidate.capabilities.text;
    };

    const getRouteModelFallback = (providerKey, routeType) => (
        routeType === 'image'
            ? draft.providers[providerKey]?.imageModel || ''
            : draft.providers[providerKey]?.textModel || ''
    );

    const validate = () => {
        for (const [routeKey, label, routeType] of ROUTES) {
            const route = draft.routes[routeKey];
            if (!routeProviderSupports(route.provider, routeType)) {
                return `${label} uses a provider that is disabled or unsupported.`;
            }
            if (!route.model?.trim()) {
                return `${label} requires a model.`;
            }
        }
        return '';
    };

    const handleSave = async () => {
        const validationMessage = validate();
        if (validationMessage) {
            setStatusMessage(validationMessage);
            return;
        }

        setIsSaving(true);
        setStatusMessage('');
        try {
            const providers = Object.fromEntries(Object.entries(draft.providers).map(([key, value]) => ([
                key,
                {
                    ...value,
                    apiKey: secrets[key] || '',
                },
            ])));
            const savedSettings = await updateAiSettings({
                defaults: draft.defaults,
                pricing: {
                    routes: Object.fromEntries(ROUTES.map(([routeKey]) => ([
                        routeKey,
                        {
                            image: Number(draft.pricing.routes[routeKey]?.image || 0),
                            input: Number(draft.pricing.routes[routeKey]?.input || 0),
                            output: Number(draft.pricing.routes[routeKey]?.output || 0),
                        },
                    ]))),
                },
                providers,
                routes: draft.routes,
            });
            onSaved(savedSettings);
            onNotify?.({ message: 'AI providers and routes saved.', title: 'Settings Updated', type: 'success' });
            onClose();
        } catch (error) {
            setStatusMessage(error.message);
            onNotify?.({ message: error.message, title: 'Settings Save Failed', type: 'error' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="settings-overlay">
            <aside className="settings-panel">
                <div className="settings-panel-header">
                    <div>
                        <h2>AI Settings</h2>
                        <p>Configure providers, routes, defaults, and pricing.</p>
                    </div>
                    <button type="button" className="settings-close" onClick={onClose}>Close</button>
                </div>

                <StatusMessage message={statusMessage} tone="error" />

                <section className="settings-section">
                    <h3>Providers</h3>
                    <div className="provider-tabs">
                        {PROVIDERS.map(([key, label]) => (
                            <button
                                key={key}
                                type="button"
                                className={`provider-tab ${activeProvider === key ? 'active' : ''}`}
                                onClick={() => setActiveProvider(key)}
                            >
                                {label}
                                <span>{draft.providers[key].enabled ? 'On' : 'Off'}</span>
                            </button>
                        ))}
                    </div>

                    <div className="settings-grid">
                        <label>
                            <span>Enabled</span>
                            <select
                                className="settings-input"
                                value={provider.enabled ? 'yes' : 'no'}
                                onChange={(event) => updateProvider(activeProvider, { enabled: event.target.value === 'yes' })}
                            >
                                <option value="yes">Enabled</option>
                                <option value="no">Disabled</option>
                            </select>
                        </label>
                        <label>
                            <span>API Key</span>
                            <input
                                className="settings-input"
                                type="password"
                                placeholder={provider.hasApiKey ? 'Configured - enter a new key to replace' : 'Enter API key'}
                                value={secrets[activeProvider] || ''}
                                onChange={(event) => setSecrets((previous) => ({ ...previous, [activeProvider]: event.target.value }))}
                            />
                        </label>
                        {activeProvider !== 'google' && (
                            <label>
                                <span>Base URL</span>
                                <input
                                    className="settings-input"
                                    value={provider.baseUrl || ''}
                                    onChange={(event) => updateProvider(activeProvider, { baseUrl: event.target.value })}
                                />
                            </label>
                        )}
                        <label>
                            <span>Text Model</span>
                            <input
                                className="settings-input"
                                value={provider.textModel || ''}
                                onChange={(event) => updateProvider(activeProvider, { textModel: event.target.value })}
                            />
                        </label>
                        <label>
                            <span>Image Model</span>
                            <input
                                className="settings-input"
                                value={provider.imageModel || ''}
                                onChange={(event) => updateProvider(activeProvider, { imageModel: event.target.value })}
                            />
                        </label>
                        <label>
                            <span>Image Output</span>
                            <select
                                className="settings-input"
                                value={provider.capabilities.imageOutput ? 'yes' : 'no'}
                                onChange={(event) => updateProvider(activeProvider, { capabilities: { imageOutput: event.target.value === 'yes' } })}
                            >
                                <option value="yes">Supported</option>
                                <option value="no">Text only</option>
                            </select>
                        </label>
                        <label>
                            <span>Image Input</span>
                            <select
                                className="settings-input"
                                value={provider.capabilities.imageInput ? 'yes' : 'no'}
                                onChange={(event) => updateProvider(activeProvider, { capabilities: { imageInput: event.target.value === 'yes' } })}
                            >
                                <option value="yes">Supported</option>
                                <option value="no">Names only</option>
                            </select>
                        </label>
                    </div>
                </section>

                <section className="settings-section">
                    <h3>Operation Routes</h3>
                    <div className="route-grid">
                        {ROUTES.map(([routeKey, label, routeType]) => (
                            <div key={routeKey} className="route-row">
                                <strong>{label}</strong>
                                <select
                                    className="settings-input"
                                    value={draft.routes[routeKey].provider}
                                    onChange={(event) => {
                                        const nextProvider = event.target.value;
                                        updateRoute(routeKey, {
                                            provider: nextProvider,
                                            model: getRouteModelFallback(nextProvider, routeType),
                                        });
                                    }}
                                >
                                    {PROVIDERS.map(([key, providerLabel]) => (
                                        <option key={key} value={key} disabled={!routeProviderSupports(key, routeType)}>
                                            {providerLabel}
                                        </option>
                                    ))}
                                </select>
                                <input
                                    className="settings-input"
                                    value={draft.routes[routeKey].model || ''}
                                    onChange={(event) => updateRoute(routeKey, { model: event.target.value })}
                                />
                            </div>
                        ))}
                    </div>
                </section>

                <section className="settings-section">
                    <h3>Generation Defaults</h3>
                    <div className="settings-grid">
                        {Object.entries(DEFAULT_OPTIONS).map(([key, options]) => (
                            <label key={key}>
                                <span>{key}</span>
                                <select className="settings-input" value={draft.defaults[key]} onChange={(event) => updateDefault(key, event.target.value)}>
                                    {options.map((option) => <option key={option} value={option}>{option}</option>)}
                                </select>
                            </label>
                        ))}
                    </div>
                </section>

                <section className="settings-section">
                    <h3>Cost Estimates</h3>
                    <div className="settings-grid">
                        {ROUTES.flatMap(([routeKey, label]) => (
                            ['input', 'output', 'image'].map((key) => {
                                const route = draft.routes[routeKey];
                                return (
                                    <label key={`${routeKey}-${key}`}>
                                        <span>{label} {key}</span>
                                        <small>{route.provider} / {route.model}</small>
                                        <input
                                            className="settings-input"
                                            min="0"
                                            step="0.0000001"
                                            type="number"
                                            value={draft.pricing.routes[routeKey]?.[key] ?? 0}
                                            onChange={(event) => updateRoutePricing(routeKey, key, event.target.value)}
                                        />
                                    </label>
                                );
                            })
                        ))}
                    </div>
                </section>

                <div className="settings-actions">
                    <button type="button" className="btn-cancel" onClick={onClose}>Cancel</button>
                    <button type="button" className="btn-primary" onClick={handleSave} disabled={isSaving}>
                        {isSaving ? 'Saving...' : 'Save Settings'}
                    </button>
                </div>
            </aside>
        </div>
    );
};

export default SettingsPanel;
