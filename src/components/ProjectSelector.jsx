import React, { useState, useEffect } from 'react';

const ProjectSelector = ({ onSelect }) => {
    const [projects, setProjects] = useState([]);
    const [newProjectName, setNewProjectName] = useState('');
    const [loading, setLoading] = useState(true);

    const fetchProjects = async () => {
        try {
            const res = await fetch('/api/projects');
            const data = await res.json();
            setProjects(data);
        } catch (err) {
            console.error('Failed to fetch projects:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateProject = async (e) => {
        e.preventDefault();
        if (!newProjectName.trim()) return;

        try {
            const res = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newProjectName.trim() })
            });
            const newProject = await res.json();
            setProjects([...projects, newProject]);
            setNewProjectName('');
            onSelect(newProject);
        } catch (err) {
            console.error('Failed to create project:', err);
            alert('Failed to create project');
        }
    };

    useEffect(() => {
        fetchProjects();
    }, []);

    if (loading) return <div className="loading">Loading projects...</div>;

    return (
        <div className="project-selector-overlay">
            <div className="project-selector-card">
                <h2>Manga Maker Projects</h2>

                <div className="new-project-form">
                    <form onSubmit={handleCreateProject}>
                        <input
                            type="text"
                            placeholder="New Project Name..."
                            value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)}
                        />
                        <button type="submit" className="btn-primary">Create New Project</button>
                    </form>
                </div>

                <div className="project-list">
                    <h3>Recent Projects</h3>
                    {projects.length === 0 ? (
                        <p className="empty-msg">No projects found. Create one to get started!</p>
                    ) : (
                        <div className="projects-grid">
                            {projects.map((p) => (
                                <button
                                    key={p.id}
                                    className="project-card"
                                    onClick={() => onSelect(p)}
                                >
                                    <div className="project-icon">📂</div>
                                    <div className="project-info">
                                        <span className="project-name">{p.name}</span>
                                        {p.createdAt && (
                                            <span className="project-date">
                                                {new Date(p.createdAt).toLocaleDateString()}
                                            </span>
                                        )}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ProjectSelector;
