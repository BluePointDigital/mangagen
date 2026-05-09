import React, { useEffect, useState } from 'react';
import StatusMessage from './ui/StatusMessage';
import { createProject, isBackendUnavailableError, listProjects } from '../lib/api.mjs';

const ProjectSelector = ({ onBackendReady, onBackendUnavailable, onExportProject, onImportProject, onNotify, onSelect }) => {
    const [projects, setProjects] = useState([]);
    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectMode, setNewProjectMode] = useState('manga');
    const [loading, setLoading] = useState(true);
    const [formMessage, setFormMessage] = useState('');
    const [isImporting, setIsImporting] = useState(false);

    const fetchProjects = async () => {
        try {
            const data = await listProjects();
            setProjects(data);
            setFormMessage('');
            onBackendReady?.();
        } catch (error) {
            console.error('Failed to fetch projects:', error);
            setFormMessage(error.message);
            if (isBackendUnavailableError(error)) {
                onBackendUnavailable?.(error.message);
            } else {
                onNotify?.({ message: error.message, title: 'Projects Unavailable', type: 'error' });
            }
        } finally {
            setLoading(false);
        }
    };

    const handleCreateProject = async (event) => {
        event.preventDefault();
        const trimmedName = newProjectName.trim();
        if (!trimmedName) {
            setFormMessage('Project name is required.');
            return;
        }

        try {
            const newProject = await createProject({ name: trimmedName, mode: newProjectMode });
            setProjects((previous) => [newProject, ...previous.filter((project) => project.id !== newProject.id)]);
            setNewProjectName('');
            setNewProjectMode('manga');
            setFormMessage('');
            onBackendReady?.();
            onSelect(newProject);
        } catch (error) {
            console.error('Failed to create project:', error);
            setFormMessage(error.message);
            if (isBackendUnavailableError(error)) {
                onBackendUnavailable?.(error.message);
            } else {
                onNotify?.({ message: error.message, title: 'Project Not Created', type: 'error' });
            }
        }
    };

    const handleImportProject = async (event) => {
        const file = event.target.files?.[0];
        if (!file || !onImportProject) return;
        setIsImporting(true);
        try {
            const importedProject = await onImportProject(file);
            if (importedProject) {
                setProjects((previous) => [importedProject, ...previous.filter((project) => project.id !== importedProject.id)]);
            }
            setFormMessage('');
        } catch (error) {
            setFormMessage(error.message);
        } finally {
            setIsImporting(false);
            event.target.value = '';
        }
    };

    useEffect(() => {
        fetchProjects();
    }, []);

    if (loading) return <div className="loading">Loading projects...</div>;

    return (
        <div className="project-selector-overlay">
            <div className="project-selector-card">
                <div className="project-selector-header">
                    <h2>MangaGen Projects</h2>
                    <label className="btn-secondary import-project-btn">
                        {isImporting ? 'Importing...' : 'Import Project'}
                        <input type="file" accept=".zip,.mangagen.zip,application/zip" onChange={handleImportProject} disabled={isImporting} />
                    </label>
                </div>

                <div className="new-project-form">
                    <form onSubmit={handleCreateProject}>
                        <input
                            type="text"
                            placeholder="New Project Name..."
                            value={newProjectName}
                            onChange={(event) => {
                                setNewProjectName(event.target.value);
                                if (formMessage) setFormMessage('');
                            }}
                        />
                        <div className="mode-selection">
                            <label>Project Type:</label>
                            <div className="mode-options">
                                <button
                                    type="button"
                                    className={`mode-option-btn ${newProjectMode === 'manga' ? 'selected' : ''}`}
                                    onClick={() => setNewProjectMode('manga')}
                                >
                                    <span className="mode-icon">Panels</span>
                                    <span className="mode-label">Manga</span>
                                    <span className="mode-desc">Panels, dialogue, SFX</span>
                                </button>
                                <button
                                    type="button"
                                    className={`mode-option-btn ${newProjectMode === 'storybook' ? 'selected' : ''}`}
                                    onClick={() => setNewProjectMode('storybook')}
                                >
                                    <span className="mode-icon">Pages</span>
                                    <span className="mode-label">Storybook</span>
                                    <span className="mode-desc">Illustrations, overlays, export</span>
                                </button>
                            </div>
                        </div>
                        <StatusMessage message={formMessage} tone="error" />
                        <button type="submit" className="btn-primary">Create New Project</button>
                    </form>
                </div>

                <div className="project-list">
                    <h3>Recent Projects</h3>
                    {projects.length === 0 ? (
                        <p className="empty-msg">No projects found. Create one to get started.</p>
                    ) : (
                        <div className="projects-grid">
                            {projects.map((project) => (
                                <div
                                    key={project.id}
                                    className={`project-card ${project.mode === 'storybook' ? 'storybook-project' : 'manga-project'}`}
                                >
                                    <button type="button" className="project-card-open" onClick={() => onSelect(project)}>
                                        <div className="project-icon">{project.mode === 'storybook' ? 'Book' : 'Manga'}</div>
                                        <div className="project-info">
                                            <span className="project-name">{project.name}</span>
                                            <span className="project-mode-tag">
                                                {project.mode === 'storybook' ? 'Storybook' : 'Manga'}
                                            </span>
                                            {project.createdAt && (
                                                <span className="project-date">{new Date(project.createdAt).toLocaleDateString()}</span>
                                            )}
                                        </div>
                                    </button>
                                    <button type="button" className="project-card-action" onClick={() => onExportProject?.(project)}>
                                        Export
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ProjectSelector;
