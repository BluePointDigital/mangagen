export const STORYBOOK_TEXT_SOURCE = Object.freeze({
    story: 'story',
    summary: 'summary',
    prompt: 'prompt',
    manual: 'manual',
    placeholder: 'placeholder',
});

const DEFAULT_PLACEHOLDER_TEXT = 'Click to add text...';

const escapeHtml = (unsafe) => {
    if (unsafe == null) return '';
    return String(unsafe)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

const trimText = (value) => String(value || '').trim();

export const textToStorybookHtml = (text) => {
    const safe = escapeHtml(text || '').trim();
    if (!safe) return '<p></p>';
    return `<p>${safe.replace(/\n/g, '<br />')}</p>`;
};

export const getStorybookTextHtmlForSource = (source, {
    fallbackText,
    promptText,
    summaryText,
    placeholderText = DEFAULT_PLACEHOLDER_TEXT,
} = {}) => {
    switch (source) {
        case STORYBOOK_TEXT_SOURCE.story:
            return trimText(fallbackText) ? textToStorybookHtml(fallbackText) : null;
        case STORYBOOK_TEXT_SOURCE.summary:
            return trimText(summaryText) ? textToStorybookHtml(summaryText) : null;
        case STORYBOOK_TEXT_SOURCE.prompt:
            return trimText(promptText) ? textToStorybookHtml(promptText) : null;
        case STORYBOOK_TEXT_SOURCE.placeholder:
            return textToStorybookHtml(placeholderText);
        default:
            return null;
    }
};

const inferStorybookTextSource = ({ explicitSource, html, storyHtml, promptHtml, summaryHtml, placeholderHtml }) => {
    if (html && storyHtml && html === storyHtml) return STORYBOOK_TEXT_SOURCE.story;
    if (html && summaryHtml && html === summaryHtml) return STORYBOOK_TEXT_SOURCE.summary;
    if (html && promptHtml && html === promptHtml) return STORYBOOK_TEXT_SOURCE.prompt;
    if (explicitSource && Object.values(STORYBOOK_TEXT_SOURCE).includes(explicitSource)) return explicitSource;
    if (html === placeholderHtml) return STORYBOOK_TEXT_SOURCE.placeholder;
    return STORYBOOK_TEXT_SOURCE.manual;
};

export const normalizeStorybookText = (existingText, {
    fallbackText,
    promptText,
    summaryText,
    placeholderText = DEFAULT_PLACEHOLDER_TEXT,
} = {}) => {
    const storyHtml = getStorybookTextHtmlForSource(STORYBOOK_TEXT_SOURCE.story, { fallbackText, placeholderText });
    const promptHtml = getStorybookTextHtmlForSource(STORYBOOK_TEXT_SOURCE.prompt, { promptText, placeholderText });
    const summaryHtml = getStorybookTextHtmlForSource(STORYBOOK_TEXT_SOURCE.summary, { summaryText, placeholderText });
    const placeholderHtml = getStorybookTextHtmlForSource(STORYBOOK_TEXT_SOURCE.placeholder, { placeholderText });
    const explicitSource = Object.values(STORYBOOK_TEXT_SOURCE).includes(existingText?.source)
        ? existingText.source
        : null;
    const hasRecoveredStoryText = !!trimText(fallbackText);
    const shouldRepairLegacyAutoText =
        existingText?.html != null
        && hasRecoveredStoryText
        && ((promptHtml != null
            && existingText.html === promptHtml
            && trimText(fallbackText) !== trimText(promptText))
            || (summaryHtml != null
                && existingText.html === summaryHtml
                && trimText(fallbackText) !== trimText(summaryText)));

    let html = existingText?.html ?? null;
    let source = explicitSource;

    if (explicitSource === STORYBOOK_TEXT_SOURCE.story && storyHtml && html !== storyHtml) {
        html = storyHtml;
    } else if (explicitSource === STORYBOOK_TEXT_SOURCE.summary && summaryHtml && html !== summaryHtml) {
        html = summaryHtml;
    } else if (explicitSource === STORYBOOK_TEXT_SOURCE.prompt && promptHtml && html !== promptHtml) {
        html = promptHtml;
    } else if (shouldRepairLegacyAutoText) {
        html = storyHtml;
        source = STORYBOOK_TEXT_SOURCE.story;
    }

    if (html == null) {
        html = storyHtml || placeholderHtml;
    }

    if (!source) {
        source = inferStorybookTextSource({
            explicitSource,
            html,
            storyHtml,
            promptHtml,
            summaryHtml,
            placeholderHtml,
        });
    }

    return {
        html,
        source,
    };
};

export const getStorybookTextSourceLabel = (source) => {
    switch (source) {
        case STORYBOOK_TEXT_SOURCE.story:
            return 'Story Text';
        case STORYBOOK_TEXT_SOURCE.summary:
            return 'Summary Text';
        case STORYBOOK_TEXT_SOURCE.prompt:
            return 'Prompt Text';
        case STORYBOOK_TEXT_SOURCE.placeholder:
            return 'Placeholder';
        default:
            return 'Edited';
    }
};
