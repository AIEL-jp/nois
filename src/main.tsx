import React from 'react'
import { createRoot } from 'react-dom/client'
import Home from './Home'
import Caller from './Caller'
import Answer from './Answer'
import './index.css'

function Root() {
	const [page, setPage] = React.useState<'home'|'caller'|'answer'>('home');
	const handleBack = () => setPage('home');
	if (page === 'caller') return <Caller onBack={handleBack} />;
	if (page === 'answer') return <Answer onBack={handleBack} />;
	return <Home onCall={() => setPage('caller')} onReception={() => setPage('answer')} />;
}

createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<Root />
	</React.StrictMode>
)
