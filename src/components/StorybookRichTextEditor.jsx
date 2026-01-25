import React from 'react';
import { EditorContent } from '@tiptap/react';

export const StorybookRichTextToolbar = ({
    editor,
    onPickTextColor,
    onPickHighlightColor,
}) => {
    if (!editor) return null;

    return (
        <div className="storybook-rt-toolbar" data-html2canvas-ignore="true">
            <button
                type="button"
                onClick={() => editor.chain().focus().toggleBold().run()}
                className={editor.isActive('bold') ? 'active' : ''}
                title="Bold"
            >
                <b>B</b>
            </button>
            <button
                type="button"
                onClick={() => editor.chain().focus().toggleItalic().run()}
                className={editor.isActive('italic') ? 'active' : ''}
                title="Italic"
            >
                <i>I</i>
            </button>
            <button
                type="button"
                onClick={() => editor.chain().focus().toggleUnderline().run()}
                className={editor.isActive('underline') ? 'active' : ''}
                title="Underline"
            >
                <u>U</u>
            </button>

            <span className="separator">|</span>

            <button
                type="button"
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                className={editor.isActive('bulletList') ? 'active' : ''}
                title="Bulleted list"
            >
                • List
            </button>
            <button
                type="button"
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                className={editor.isActive('orderedList') ? 'active' : ''}
                title="Numbered list"
            >
                1. List
            </button>

            <span className="separator">|</span>

            <button
                type="button"
                onClick={() => onPickTextColor?.()}
                title="Text color"
            >
                A
            </button>
            <button
                type="button"
                onClick={() => onPickHighlightColor?.()}
                title="Highlight color"
            >
                HL
            </button>

            <span className="separator">|</span>

            <button
                type="button"
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!editor.can().undo()}
                title="Undo"
            >
                ↶
            </button>
            <button
                type="button"
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!editor.can().redo()}
                title="Redo"
            >
                ↷
            </button>
        </div>
    );
};

export const StorybookRichTextContent = ({ editor }) => {
    return (
        <div className="storybook-rt-content">
            <EditorContent editor={editor} />
        </div>
    );
};

