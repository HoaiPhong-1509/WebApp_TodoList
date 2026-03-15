import React from 'react'
import { Button } from './ui/button';

export const Header = ({ userName, onLogout }) => {
  return <div className='space-y-2 text-center'>

    <div className='flex items-center justify-between gap-3'>
      <p className='text-sm text-muted-foreground text-left'>
        Signed in as <span className='font-semibold text-foreground'>{userName}</span>
      </p>
      <Button variant='outline' size='sm' onClick={onLogout}>Logout</Button>
    </div>

    <h1 className="text-4xl font-bold leading-normal text-transparent bg-primary bg-clip-text">
        Task Management App
    </h1>

  </div>
}

export default Header