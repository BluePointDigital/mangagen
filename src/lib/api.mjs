export const BACKEND_UNAVAILABLE_MESSAGE = 'Backend unavailable. Start the server on http://localhost:3001 and reload.';

const JSON_HEADERS = {
    'Content-Type': 'application/json',
};

const parseResponse = async (response) => {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return response.json();
    }
    return response.text();
};

const isBackendUnavailablePayload = (payload) => (
    typeof payload === 'string'
    && (
        payload.includes('Error occurred while trying to proxy')
        || payload.includes('ECONNREFUSED')
        || payload.includes('<!DOCTYPE html')
        || payload.includes('<html')
    )
);

const toErrorMessage = (response, payload) => {
    if (response.status >= 500 && isBackendUnavailablePayload(payload)) {
        return BACKEND_UNAVAILABLE_MESSAGE;
    }

    return payload?.error || payload || `Request failed with status ${response.status}`;
};

export const isBackendUnavailableError = (error) => (
    error instanceof Error && error.message === BACKEND_UNAVAILABLE_MESSAGE
);

export const apiRequest = async (url, options = {}) => {
    try {
        const response = await fetch(url, options);
        const payload = await parseResponse(response);

        if (!response.ok) {
            throw new Error(toErrorMessage(response, payload));
        }

        return payload;
    } catch (error) {
        if (error instanceof Error && error.message === 'fetch failed') {
            throw new Error(BACKEND_UNAVAILABLE_MESSAGE);
        }

        throw error;
    }
};

export const listProjects = () => apiRequest('/api/projects');

export const createProject = (payload) => apiRequest('/api/projects', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
});

export const getProject = (projectId) => apiRequest(`/api/projects/${projectId}`);

export const updateProject = (projectId, payload) => apiRequest(`/api/projects/${projectId}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
});

export const exportProject = async (projectId) => {
    const response = await fetch(`/api/projects/${projectId}/export`);
    if (!response.ok) {
        const payload = await parseResponse(response);
        throw new Error(toErrorMessage(response, payload));
    }
    return response.blob();
};

export const importProject = async (file) => {
    const response = await fetch('/api/projects/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: file,
    });
    const payload = await parseResponse(response);
    if (!response.ok) {
        throw new Error(toErrorMessage(response, payload));
    }
    return payload;
};

export const getLibrary = (projectId = null) => apiRequest(
    projectId ? `/api/library?projectId=${projectId}` : '/api/library'
);

export const getAiSettings = () => apiRequest('/api/settings/ai');

export const updateAiSettings = (payload) => apiRequest('/api/settings/ai', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
});

export const getGenerationHistory = (projectId) => apiRequest(`/api/projects/${projectId}/generation-history`);

export const generatePage = (payload) => apiRequest('/api/generate', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
});

export const generatePanel = (payload) => apiRequest('/api/generate-panel', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
});

export const planStory = (payload) => apiRequest('/api/plan', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
});

export const editImage = (payload) => apiRequest('/api/edit', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
});

export const saveAsset = (payload) => apiRequest('/api/save', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
});
