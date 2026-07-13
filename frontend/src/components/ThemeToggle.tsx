import React, { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const ThemeToggle: React.FC = () => {
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved ? saved === 'dark' : true;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.remove('light-theme');
      root.classList.add('dark-theme');
      localStorage.setItem('theme', 'dark');
    } else {
      root.classList.remove('dark-theme');
      root.classList.add('light-theme');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  return (
    <button
      onClick={() => setIsDark(!isDark)}
      className="theme-toggle-btn"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.3rem',
        background: 'rgba(255,255,255,0.1)',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        padding: '0.4rem 0.8rem',
        color: 'var(--text-primary)',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
    >
      {isDark ? <Moon size={16} /> : <Sun size={16} />}
      {isDark ? 'Dark' : 'Light'}
    </button>
  );
};

export default ThemeToggle;
