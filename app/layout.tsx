import type { Metadata } from "next";
export const metadata: Metadata = {title:"IN A PINCH · Key West Bathroom Map",description:"when you gotta go, you gotta go"};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>;}
